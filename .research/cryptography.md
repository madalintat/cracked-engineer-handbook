# Cryptography — Primitives, Protocols, and the Hardware That Runs Them

**Research date: September 2026.** Every time-sensitive claim is dated inline. Section 5 (post-quantum) is the part that rots fastest; it carries its own dated status table and a re-check trigger.

Audience: a strong SWE who reads and writes C/C++ and x86-64 assembly (`x86-64-assembly.md`), understands caches, pipelines and memory ordering (`cpu-architectures.md`), and has been through the microarchitectural-leak material (`hardware-security.md`). This document assumes all of that and never re-explains a cache.

**Target end state:** *can name which security property a construction actually provides and which it silently does not; can implement AES-128 and CTR mode from the spec and hit the FIPS-197 vectors; can explain, from the algebra, why a repeated CTR nonce hands the attacker the plaintext and a repeated GCM nonce hands them the authentication key; can pick between a MAC and a signature and justify it; can read a constant-time routine and say what the compiler is being prevented from doing; and knows the current post-quantum deployment state with dates.*

### Scope boundaries — deliberately not covered here

| Topic | Lives in |
|---|---|
| Hash function internals (Merkle–Damgård, sponge/Keccak, SHA-2/SHA-3 construction, collision resistance, length extension) | `information-theory-coding.md` |
| TLS handshake message flow, 0-RTT, ALPN, ECH, record layer, QUIC crypto | `networking-and-internet.md` |
| Cache-timing attacks, Spectre-class leaks, power/EM/fault analysis as attacks | `hardware-security.md` |

This document covers the **primitives**, the **protocol-level composition** of those primitives, and the **hardware and implementation engineering**. Where a boundary is genuinely shared — AES table lookups leaking through the cache, TLS 1.3's key schedule — it is stated in one paragraph here and cross-referenced rather than duplicated.

### How to read this document

- **§1** is the ground rules. It is short and it is the section people skip and then get wrong. The four properties are separate; a threat model is mandatory; the reason not to roll your own is specific and technical, not folkloric.
- **§2** is symmetric crypto, and its centrepiece is **modes of operation taught entirely through their failure modes**. This is the pedagogically strongest material in the whole document — each mode is introduced by the attack that killed it.
- **§3** is asymmetric crypto: DH, RSA, elliptic curves, signatures. RSA is presented partly as a historical object.
- **§4** is composition: TLS 1.3's key schedule, the double ratchet, the CA trust model, JWT.
- **§5** is post-quantum, with hard dates and a verification ledger.
- **§6** is the hardware — AES-NI, PCLMULQDQ, ARM crypto extensions, constant-time engineering, bignum arithmetic, secure elements. **This is what earns cryptography a place in a hardware curriculum.**
- **§7** is the curriculum: three units in dependency order with machine-checkable exercises.
- **Appendix A** is the verification ledger (what was checked against a primary source, what was not).
- **Appendix B** is a ranked reading list.

### Conventions

- Claims that could not be verified against a primary or reputable secondary source during this research are marked **[unverified]**.
- Performance numbers are marked with the part they were measured on. Cycles-per-byte figures vary by a factor of two or more across microarchitectures; treat them as order-of-magnitude.
- **Every code fragment in this document is for teaching.** None of it should ship. §1.4 explains why, in a way that is meant to be convincing rather than scolding.

---

## 1. The ground rules

### 1.1 Four properties, four mechanisms, and the fact that they are separate

The single most common conceptual error in applied cryptography is treating "encrypted" as a synonym for "secure". It is not. There are four distinct properties, they are provided by different mechanisms, and getting one does not get you the others.

| Property | What it means | What provides it | What does **not** provide it |
|---|---|---|---|
| **Confidentiality** | An adversary who sees the ciphertext learns nothing about the plaintext beyond its length | A cipher (AES-CTR, ChaCha20) | A MAC, a hash, a signature |
| **Integrity** | Any modification to the message is detected | A MAC (HMAC, Poly1305, GMAC) or a signature | A cipher. **Encryption does not protect integrity.** |
| **Authenticity** | The message came from a party holding the key | A MAC or a signature | A cipher; a hash of the plaintext |
| **Non-repudiation** | A *third party* can be convinced the message came from a specific principal, and the sender cannot later deny it | A digital signature (asymmetric) only | A MAC — both parties hold the key, so either could have produced the tag |

Two consequences worth stating flatly, because both get violated in production code constantly:

**Encryption without authentication is a bug, not a trade-off.** A raw CTR-mode ciphertext is *fully malleable*: flip bit *i* of the ciphertext and you have flipped bit *i* of the plaintext, with no way for the recipient to notice. CBC is malleable in a messier but still exploitable way. Every unauthenticated mode hands the attacker a plaintext-editing primitive. This is not theoretical — padding-oracle attacks (§2.5), the BEAST/POODLE family, and the entire history of TLS's record layer are consequences.

**A MAC is not a signature.** They both produce a short tag that proves the message was not tampered with, and beginners use the words interchangeably. But a MAC key is *shared*. If Alice and Bob share a MAC key, Bob cannot prove to a judge that Alice sent a message, because Bob could have made it himself. If you need a third party to be convinced, you need a signature, and you will pay roughly three orders of magnitude in CPU for the privilege (§4.6 has the numbers and the decision rule).

### 1.2 Kerckhoffs's principle

Auguste Kerckhoffs, *La Cryptographie Militaire* (Journal des Sciences Militaires, January 1883), stated six desiderata for a military cipher. The second is the one that survived:

> *Il faut qu'il n'exige pas le secret, et qu'il puisse sans inconvénient tomber entre les mains de l'ennemi.*
> ("It must not require secrecy, and it must be able to fall into enemy hands without inconvenience.")

The modern form: **the security of the system must rest entirely on the secrecy of the key, never on the secrecy of the design.** Shannon restated it as "the enemy knows the system."

The reasons are practical, not aesthetic:

- **Keys can be rotated; designs cannot.** A leaked key costs you one rekey. A leaked algorithm you were relying on costs you a redesign, a redeploy, and every ciphertext ever produced.
- **Secret designs do not get reviewed.** The only thing that produces confidence in a cryptographic construction is years of skilled people failing to break it. A secret design gets zero of that, and the confidence it inspires internally is unearned.
- **Secret designs leak anyway.** They are in shipped binaries. They are reverse-engineered. Every historically significant proprietary cipher — A5/1 and A5/2 in GSM, COMP128, the Mifare Classic CRYPTO1 cipher, the KeeLoq rolling-code cipher, the Texas Instruments DST40 transponder, the RC4 disclosure — was reverse-engineered from a product and then broken within a short time of publication. The record is one-sided enough that "we designed our own and haven't published it" should be read as an admission.

The corollary that matters for a curriculum: **you should be suspicious of any system whose security argument you cannot fully inspect.** That includes hardware RNGs (§1.6).

### 1.3 Threat models, and why "secure" is a meaningless word

"Is this secure?" is not a question that can be answered. The answerable question is: **secure against whom, with what capabilities, doing what, and at what cost to them?**

A threat model states, at minimum:

1. **What you are protecting** (assets: the plaintext, the key, the fact that communication occurred, the user's identity, availability).
2. **Who the adversary is and what they can do** (read the wire? modify it? run code on the same machine? get physical possession? issue a subpoena? measure power draw? coerce a CA?).
3. **What is explicitly out of scope** — the most valuable and most often omitted part.
4. **What "broken" means** — recovering one message is different from recovering the key, which is different from distinguishing two ciphertexts.

The standard formal ladder for a cipher, in increasing adversary strength:

- **IND-CPA** (indistinguishability under chosen-plaintext attack): the adversary may get arbitrary plaintexts encrypted, and still cannot distinguish which of two chosen plaintexts a challenge ciphertext corresponds to. **Every deterministic cipher fails IND-CPA automatically** — this is exactly why ECB is dead (§2.5) and why textbook RSA is dead (§3.3).
- **IND-CCA2** (chosen-ciphertext, adaptive): the adversary may additionally ask for arbitrary ciphertexts (other than the challenge) to be decrypted. This is the level real protocols need, because a real protocol *is* a decryption oracle — it receives attacker-supplied ciphertexts and behaves observably differently depending on whether they decrypt. Padding oracles (§2.5) are precisely a CCA2 attack made real.
- **AE / AEAD security**: IND-CPA plus **ciphertext integrity (INT-CTXT)** — the adversary cannot produce any new ciphertext that decrypts successfully. AE security implies IND-CCA2. This is what you should actually be building on (§2.7).

A worked example of why the model is everything: **AES-128-CBC with a random IV and a separate HMAC-SHA-256, encrypt-then-MAC**, is a fine construction against a network adversary. Against an adversary with a stopwatch and code co-resident on your machine, the table-driven AES implementation underneath may leak the key through the cache (§2.3, and `hardware-security.md` §4.2). Against an adversary with an oscilloscope on the power rail of a smartcard, it leaks faster. None of these are contradictions; they are three different threat models and the same construction is secure in one and broken in the others.

**Teaching note.** Make students write the threat model *before* the design, every time. The exercise that lands hardest: give them a "secure messaging app" spec and ask them to enumerate what it does *not* protect. Metadata (who talked to whom, when, how much) is almost never protected and is frequently the more valuable asset.

### 1.4 Why you must not roll your own — the actual reasons

"Don't roll your own crypto" is repeated so often that it has become an incantation, and incantations do not persuade engineers. Here are the real reasons, stated as engineering facts.

**Reason 1: the failure modes are silent.** In every other domain, a bug produces a visible symptom — a wrong number, a crash, a corrupted file, a failed request. In cryptography, the overwhelming majority of catastrophic bugs produce **output that is indistinguishable from correct output to anyone without the attack**. An AES implementation with a broken key schedule still turns plaintext into ciphertext-looking bytes and back again. A CTR mode that reuses a nonce still round-trips perfectly. An ECDSA implementation with a biased nonce still produces signatures that verify. A random number generator seeded with the PID produces bytes that look random in a hex dump and pass a chi-squared test.

**Reason 2: your test suite passes.** This follows from reason 1 and is worth its own line because it is the thing engineers rely on. The natural test for a crypto routine is a round-trip: encrypt, decrypt, assert equality. **That test passes on essentially every broken implementation.** It passes with a nonce that never changes. It passes with a key schedule that only uses half the key. It passes with an all-zero IV. It passes with a MAC that is never checked, because the decrypt path doesn't need the MAC to produce the right plaintext. The one class of bug it catches — "the bytes don't round-trip" — is the one class that is not a security bug.

**Reason 3: correctness is not observable.** In normal software, "does it work?" and "is it correct?" are close enough to be treated as the same question. In cryptography they are unrelated. The property you actually need — *no adversary with these capabilities can do this thing* — is a statement quantified over all adversaries, and there is no experiment you can run that establishes it. You cannot test for the absence of a distinguisher. Test vectors (FIPS-197, RFC 4231) establish that you implemented the *specified function*, which is necessary and nowhere near sufficient: they say nothing about whether your implementation is constant-time, whether your nonces are unique, whether you check the tag before decrypting, or whether the compiler removed your key-zeroing memset.

**Reason 4: the gap between "the algorithm" and "a secure implementation" is where all the bugs live.** The AES specification is about twelve pages. A secure AES implementation must additionally: run in constant time regardless of key and data; not leak through cache line selection; handle key material without it landing in swap or a core dump; be zeroed after use in a way the compiler cannot elide; and be composed into a mode with correct nonce management. Approximately none of this is in the spec, and all of it has been the subject of published attacks.

**Reason 5: the reviewed libraries have absorbed decades of attacks you have never heard of.** Read the git log of BoringSSL or libsodium and count the commits that are one-line fixes for attacks with names. Every one of those is a mistake someone made, published, and then everyone fixed. Rolling your own means starting that process from scratch, alone, without the attacks.

**The honest exception, and it is the reason this document exists:** implementing primitives *for the purpose of understanding them* is enormously valuable and everyone serious should do it. The rule is not "never write AES." The rule is **"never deploy the AES you wrote."** §7's exercises all involve writing primitives; every one of them carries that instruction.

### 1.5 Computational vs information-theoretic security, and the one-time pad

There are exactly two kinds of security argument.

**Information-theoretic (unconditional) security** means the ciphertext contains *no information* about the plaintext, in Shannon's sense — the a-posteriori distribution of plaintexts given the ciphertext equals the a-priori distribution. An adversary with infinite computing power, running until the heat death of the universe, learns nothing. This is proven, not assumed.

**Computational security** means breaking the scheme requires solving a problem believed to be intractable — factoring, discrete log, or "distinguishing AES from a random permutation". These are *assumptions*. Nobody has proven that factoring is hard; nobody has even proven P ≠ NP. Every practical cryptosystem you use rests on unproven assumptions that have merely survived a lot of attention.

**The one-time pad** is the canonical information-theoretically secure cipher. Ciphertext = plaintext XOR key, where the key is uniformly random and as long as the message. Shannon proved (1949, *Communication Theory of Secrecy Systems*) that it achieves perfect secrecy — and, importantly, that **any perfectly secret cipher requires a key at least as long as the message**. So the OTP is not just *an* answer; it is essentially *the* answer, and its cost is unavoidable.

The proof of perfect secrecy is two lines and worth showing: for any ciphertext *c* and any candidate plaintext *m*, there is exactly one key *k = c ⊕ m* that maps *m* to *c*, and all keys are equally likely. So every plaintext of that length is equally consistent with the ciphertext. The ciphertext narrows nothing.

**Why it is impractical**, precisely:

1. **Key length.** You need one truly random key bit per message bit. To send a gigabyte you must first have securely exchanged a gigabyte of key. But if you have a secure channel capable of moving a gigabyte, you could have sent the message over it. The OTP does not solve the key distribution problem; it converts it into an equally large key distribution problem with the timing shifted.
2. **Key reuse is catastrophic and the temptation is enormous.** Use a pad twice and you have a two-time pad: `C₁ ⊕ C₂ = P₁ ⊕ P₂`, and the key vanishes from the equation. Two English plaintexts XORed together are recoverable by hand, by crib-dragging. This is not hypothetical: the **VENONA** project (US Army Signal Intelligence Service, 1943–1980) read Soviet diplomatic traffic for decades because a Soviet supplier duplicated about 35,000 pages of one-time pad in 1942 under wartime pressure. **This exact failure recurs today as CTR-mode nonce reuse** (§2.6), which is why the OTP earns its place in a curriculum: it is the simplest possible setting in which to internalise "never reuse keystream."
3. **Randomness at scale.** The key must be *truly* random, not the output of a PRNG. If you generate the pad with a PRNG you have built a stream cipher, and its security is the PRNG's — computational, not information-theoretic. You have paid the OTP's key-distribution cost and received a stream cipher's security guarantee.
4. **No integrity whatsoever.** OTP is perfectly confidential and perfectly malleable. An attacker who knows the plaintext format can flip any bit they like. "Perfect secrecy" is a statement about confidentiality only, and this is the cleanest illustration of §1.1's point that the properties are separate.
5. **Key management.** Generating, distributing, storing, synchronising and *destroying after use* one-use key material at scale is an operational nightmare, and the "destroying after use" part is what VENONA proves people get wrong.

The lesson to draw: **we accept computational security not because it is better but because information-theoretic security is unaffordable.** AES-256 with a 32-byte key can protect a terabyte. That leverage — a short key protecting an arbitrarily long message — is *only* available under a computational assumption. The assumption is the price of the leverage.

### 1.6 Randomness — the substrate everything sits on

Every cryptosystem in this document assumes a source of bytes that an adversary cannot predict. When that assumption fails, nothing else matters: keys become guessable, nonces repeat, signatures leak private keys. **Randomness failures are the single most productive source of real-world total breaks**, and they are the best teaching stories in the field because the bug is always tiny and the consequence is always total.

#### PRNG vs CSPRNG

A **PRNG** (pseudo-random number generator) stretches a seed into a long sequence that passes statistical tests. `rand()`, `std::mt19937` (Mersenne Twister), `java.util.Random`, xorshift, PCG. They are designed for simulation, sampling and games. The design goal is *statistical* quality — uniform distribution, long period, good equidistribution.

A **CSPRNG** additionally guarantees, against a computationally bounded adversary:

- **Next-bit unpredictability**: given the first *k* output bits, you cannot predict bit *k+1* better than by guessing.
- **State compromise resistance**: given the internal state at time *t*, you cannot recover previous outputs (**backtracking resistance / forward secrecy**), and — with fresh entropy mixed in — the generator recovers unpredictability going forward (**prediction resistance / post-compromise security**).

Mersenne Twister fails the first requirement spectacularly: it is a linear recurrence over GF(2), and **624 consecutive 32-bit outputs let you reconstruct the entire internal state and predict all future output**, with the untempering being about thirty lines of code. This is a wonderful five-minute classroom demo: generate 624 values, recover the state, predict the 625th, assert equality.

The rule is simple and admits no exceptions: **if a value needs to be unpredictable to anyone, it comes from a CSPRNG.** Keys, nonces, IVs, salts, session tokens, password-reset tokens, CSRF tokens, ECDSA nonces. Never `rand()`, never Mersenne Twister, never a hash of the current time and the PID.

#### Entropy sources and how the OS gets them

A CSPRNG needs a seed with real entropy. The kernel harvests it from physically unpredictable events:

- Interrupt timings (the jitter in when a device raises an interrupt, measured against a high-resolution counter)
- Keyboard and mouse timings on interactive machines
- Disk seek timings on rotational media (largely gone with SSDs)
- Hardware RNG output (`RDRAND`/`RDSEED` on x86, `RNDR` on ARMv8.5, on-chip entropy on most SoCs)
- Boot-time seed files carried across reboots (`/var/lib/systemd/random-seed`)
- Firmware/bootloader-supplied entropy (device tree `rng-seed`, EFI `EFI_RNG_PROTOCOL`)

Linux mixes these into a pool and uses ChaCha20 as the output CSPRNG (since the 4.8-era rework and the more thorough 5.17/5.18 overhaul by Jason Donenfeld). The pool is periodically rekeyed from itself in a way that provides backtracking resistance.

**The hard case is early boot on a headless embedded device**: no keyboard, no mouse, no spinning disk, no saved seed on first boot, and interrupt timings that are nearly deterministic because the boot sequence is nearly deterministic. This is where real-world entropy failures cluster — routers and IoT devices generating SSH host keys and TLS keys seconds after power-on. Heninger, Durumeric, Wustrow and Halderman's *"Mining Your Ps and Qs: Detection of Widespread Weak Keys in Network Devices"* (USENIX Security 2012) scanned the whole IPv4 space and found **0.75% of TLS certificates shared keys** due to insufficient boot entropy, and were able to **compute the private keys for 0.50% of TLS hosts and 0.03% of SSH hosts** — the latter mostly by finding pairs of RSA moduli sharing a prime factor, recoverable by a batch GCD over the whole corpus. That paper is the definitive teaching artefact for this failure mode: the mathematics of the attack (GCD of two moduli) is trivial, and the scale is enormous.

#### `/dev/urandom` vs `/dev/random` vs `getrandom(2)` — the settled advice

This was a genuine controversy for about fifteen years and it is now settled. The history matters because the wrong advice is still all over the internet.

**The old folklore** said `/dev/random` was "more secure" because it blocked when the kernel's *entropy estimate* was low, whereas `/dev/urandom` would keep producing output regardless. This rested on an information-theoretic intuition — that a CSPRNG "uses up" entropy as it outputs bytes — which is simply wrong for a computationally secure generator. Once a CSPRNG is seeded with, say, 256 bits of real entropy, it can emit terabytes without any adversary gaining an advantage, because predicting the output would require breaking ChaCha20. The kernel's "entropy count" was a conservative heuristic, not a physical quantity, and treating it as one caused real, observable harm: applications hanging for minutes or hours at boot waiting on `/dev/random`, and — worse — developers routing around the hang with something homemade.

**The genuine problem** `/dev/random`'s blocking was trying to solve is real, but it is a *different* problem: `/dev/urandom` historically would return output **before the pool was ever initialised**, on a freshly booted system. That output was predictable. So the true rule was never "urandom is weak"; it was "urandom is fine *once initialised*, and there was no clean way to wait for exactly that."

**`getrandom(2)` is the fix**, and it is the modern answer. Available since **Linux 3.17 (October 2014)**, exposed via glibc since **2.25**. Verified against the man page (man7.org, fetched September 2026):

- By default it draws from the **urandom source** and **blocks only until the pool is initialised** — exactly the semantics you want, and never afterwards.
- `GRND_NONBLOCK` makes it return `EAGAIN` instead of blocking, for callers that cannot wait.
- `GRND_RANDOM` selects the legacy `/dev/random` behaviour. **You do not want this.**
- For requests of **up to 256 bytes** from the urandom source after initialisation, it returns the full amount and is not interrupted by signals — so the short-read handling that plagues `read()` on a device file mostly goes away. Larger requests can still return partial data or `EINTR`, so a loop is still correct practice.

It also has the structural advantage of being a **syscall**, not a file: it works when the file descriptor table is exhausted, inside a chroot or a container with no `/dev`, and in a seccomp sandbox that has no `open()`. Every one of those has bitten a real deployment.

Since **Linux 5.6 (March 2020)** `/dev/random` also blocks only until initialisation rather than on a per-read entropy estimate, which retires the last practical difference. (The man page fetched for this research did not itself state the 5.6 change — that detail is **[unverified against the man page]** though it is well documented in the 5.6 changelog and Donenfeld's write-ups.)

**The rule, stated once:**

| Use | Call |
|---|---|
| Linux, C | `getrandom(buf, len, 0)`, in a loop, checking the return | 
| Linux, glibc ≥ 2.36 | `getentropy(buf, len)` — the simpler wrapper, ≤ 256 bytes, never partial |
| macOS / BSD | `arc4random_buf()` or `getentropy()` |
| Windows | `BCryptGenRandom(NULL, buf, len, BCRYPT_USE_SYSTEM_PREFERRED_RNG)` (or `RtlGenRandom`) |
| Any language with a crypto stdlib | `secrets` (Python), `crypto.randomBytes` (Node), `crypto/rand` (Go), `getrandom` crate / `OsRng` (Rust), `SecureRandom` (Java) |
| A crypto library is already linked | Use its RNG — `randombytes_buf()` (libsodium), `RAND_bytes()` (OpenSSL) |

**Anti-rules**, each of which corresponds to a real incident: do not implement your own entropy pool; do not mix in "extra entropy" from timestamps or PIDs in the belief that it helps (it can only help if the kernel source failed, and if the kernel source failed you have bigger problems — but it *can* hurt if your mixing is unsound); do not cache randomness across a `fork()` (both children get the same bytes — this is why libraries register `pthread_atfork` handlers or check the fork generation counter, and why MADV_WIPEONFORK exists); do not cache it across a VM snapshot restore (the same problem, but you get no callback at all — this is why VMs need a paravirtual entropy device such as `virtio-rng`).

#### Hardware RNGs, and why `RDRAND` is not simply trusted

Modern CPUs have on-die entropy sources. On x86, Intel's Secure Key provides:

- **`RDSEED`** — output of the conditioned entropy source itself, intended for *seeding* other generators. Lower throughput; can fail (CF=0) when entropy is not yet available, so it must be retried.
- **`RDRAND`** — output of a hardware CSPRNG (an AES-CTR-DRBG) reseeded from that entropy source. Higher throughput. Also sets CF to indicate success — **and code that ignores CF is a real and recurring bug class**, because on failure the destination register is zeroed, so an unchecked `RDRAND` can silently hand you zero.

ARMv8.5-A adds `RNDR` and `RNDRRS` with the same shape.

**The trust problem** is structural: the entropy source is a physical circuit inside a die you cannot inspect, and its output goes through a conditioning step you also cannot inspect. A backdoored `RDRAND` that emitted the output of AES-CTR under a key known to the manufacturer would be **statistically perfect** and undetectable by any black-box test. This is not paranoia in the abstract: the Dual_EC_DRBG affair — a NIST-standardised generator (SP 800-90A, 2006) with a structure that admits a backdoor if the standardiser chose the curve points with a known relationship, later reported to have been a deliberate NSA effort, withdrawn by NIST in 2014 — established that standardised RNG backdoors are a thing that has actually happened. Separately, in 2013 Theodore Ts'o publicly refused to let `RDRAND` be Linux's sole entropy source; the Linux kernel has ever since **mixed** `RDRAND` output into the pool rather than trusting it directly, so that a compromised `RDRAND` can only fail to help, never actively hurt. (There is a `random.trust_cpu` boot option; the default has flipped over the years, and the current default is version-dependent — **[unverified for 2026 kernels]**.)

There have also been plain bugs: **AMD Ryzen 3000-series CPUs shipped with firmware in which `RDRAND` returned 0xFFFFFFFF constantly** while still setting the success flag (2019, fixed in AGESA microcode). systemd added a check because of it. That is the strongest possible argument for the mixing approach: a hardware RNG should be *one input*, checked, never the whole story.

**The design principle to teach:** never let any single entropy source be load-bearing. Mix several, and mix them with a construction where a bad input cannot cancel out a good one (XOR into a pool then hash, not "pick one").

#### Failure story 1: the Debian OpenSSL bug (CVE-2008-0166)

The best teaching story in all of applied cryptography, because the diff is two lines and the blast radius was global.

In May 2006, a Debian maintainer ran Valgrind against OpenSSL and saw warnings: the PRNG seeding code in `ssleay_rand_add` was reading uninitialised memory. This was **deliberate** — OpenSSL was scooping up whatever happened to be in an uninitialised buffer as a small extra entropy contribution (a dubious practice, but harmless). Uninitialised reads are exactly what Valgrind exists to flag, so the warnings were noisy and were drowning out real findings.

The maintainer asked on `openssl-dev` whether it was safe to remove the offending lines, got an answer that was about the wrong function, and commented out **two** calls to `MD_Update()`. One was the harmless uninitialised-buffer read. **The other was the call that mixed in all the actual entropy.**

The result: from Debian's `openssl 0.9.8c-1` (September 2006) onwards, on Debian, Ubuntu and every derivative, the OpenSSL PRNG was seeded with **essentially only the process ID**. Linux PIDs run 1–32768, so:

- Only **32,767 distinct keys** were possible for any given key type, key size and architecture.
- The entire keyspace could be — and immediately was — **enumerated and published**. Precomputed lists of every possible weak SSH key appeared within days.
- Affected: SSH host keys, SSH user keys, TLS/SSL server keys, OpenVPN keys, DNSSEC keys — anything generated on an affected system over roughly **20 months**.
- **The damage extended to keys that were not weak.** A strong RSA key generated elsewhere and merely *used* on an affected machine was still fine for encryption, but a **DSA** key used for signing on an affected machine was compromised outright, because DSA signing needs a fresh secret nonce per signature and the broken PRNG made those nonces enumerable — the same nonce-recovery mathematics as §3.7.

Announced 13 May 2008 (DSA-1571-1). Remediation required regenerating every key generated on an affected system for nearly two years, and OpenSSH shipped a blacklist of known-weak keys.

**What to draw out of it in a classroom.** Not "Debian was careless" — that is the wrong lesson and it is not even true; the maintainer asked before acting. The lessons are:

- **The bug was invisible.** OpenSSL worked. TLS handshakes succeeded. SSH connections were established. Certificates verified. Every test passed. This is §1.4's reason 1 in its purest form.
- **A tool designed to find bugs caused one.** Valgrind was correct; the code was doing something Valgrind rightly flags; the fix for the warning broke the security property. Cryptographic code has invariants that ordinary static and dynamic analysis cannot see.
- **The entropy source was load-bearing and singular.** Had the design mixed several sources, removing one would have degraded rather than destroyed it.
- **Ask the right people and be specific.** The mailing list exchange was ambiguous about which function was under discussion.

#### Failure story 2: the Sony PlayStation 3 ECDSA key (2010)

The other essential story, and the cleanest illustration that a nonce is not a nonce if it is constant.

ECDSA signing computes, for message hash *z*, private key *d*, and a **per-signature secret nonce** *k*:

```
R = [k]G          (a curve point)
r = x-coordinate of R,  mod n
s = k⁻¹ · (z + r·d)  mod n
signature = (r, s)
```

The security requirement on *k* is absolute: it must be **uniformly random, secret, and used exactly once**. Sony used a **constant**. The same *k* for every signature the PS3 firmware chain ever produced.

The recovery is schoolbook algebra. Given two signatures `(r, s₁)` on `z₁` and `(r, s₂)` on `z₂` with the same *k* (immediately detectable, because the same *k* gives the same *r*):

```
s₁ − s₂ = k⁻¹(z₁ + r·d) − k⁻¹(z₂ + r·d) = k⁻¹(z₁ − z₂)   mod n
  ⟹  k = (z₁ − z₂) · (s₁ − s₂)⁻¹                         mod n
  ⟹  d = (s₁·k − z₁) · r⁻¹                               mod n
```

Two signatures. Two modular inversions. The private key that signs all PlayStation 3 executables. Presented by fail0verflow as "Console Hacking 2010" at the 27th Chaos Communication Congress, December 2010.

**What to draw out of it:**

- **The nonce leaks the key by construction.** This is not an implementation weakness bolted onto an otherwise safe design; it is inherent to ECDSA's equation. Any protocol whose secret is recoverable from a repeated random value is a protocol with a landmine in it.
- **It gets much worse than full reuse.** You do not need *k* to repeat. If *k* is merely **biased** — a few bits predictable, or drawn from a range slightly smaller than *n* — the problem becomes an instance of the **Hidden Number Problem** (Boneh & Venkatesan, CRYPTO 1996) and lattice reduction recovers *d* from a few dozen to a few hundred signatures. Real instances: **Minerva** (2019, timing leak of nonce bit-length in several smartcards and libraries), **TPM-FAIL** (2019, Intel fTPM and STMicroelectronics TPM), **LadderLeak** (2020, recovering keys with **less than one bit** of nonce leakage per signature). "Slightly non-uniform" is not a small problem.
- **The fix is to remove the randomness requirement.** RFC 6979 (August 2013) specifies **deterministic ECDSA**: derive *k* as `HMAC-DRBG(private key, message hash)`. EdDSA (§3.8) builds the same idea into the algorithm. Both make the nonce a deterministic function of things you already have, so a bad RNG can no longer produce a repeated nonce.
- **The same bug recurs.** In August 2013 an Android `SecureRandom` flaw caused Bitcoin wallets to reuse ECDSA nonces, and funds were drained by attackers scanning the blockchain for repeated *r* values. The blockchain is a public database of signatures, which makes it a permanent, searchable, worldwide test for this bug. People still find hits.

#### Failure story 3: Android `SecureRandom` and the Bitcoin wallet drain (August 2013)

The third story is the one that connects the first two, because it is a Debian-shaped bug producing a PlayStation-shaped consequence.

Android's `java.security.SecureRandom`, in the versions shipping up to and including Android 4.2, had two defects that combined badly. The `SecureRandom` implementation backed by the Apache Harmony / OpenSSL provider could, under certain initialisation orders, **fail to be seeded at all** — the OpenSSL PRNG in the Android process was not always reseeded from `/dev/urandom` after the Zygote fork, and a `SecureRandom` instance constructed before seeding would return output derived from a state shared across processes. In effect, several apps starting from the same Zygote image drew from **the same PRNG state**, and in some paths from a state with almost no entropy in it at all.

For most Android apps this would have been a bad but survivable bug: session tokens with less entropy than advertised. For Bitcoin wallets it was fatal, and for exactly the reason §1.6's second story establishes. A Bitcoin transaction is authorised by an **ECDSA signature over secp256k1**, which needs a fresh secret nonce *k* per signature. Android wallets — Bitcoin Wallet, blockchain.info, BitcoinSpinner, Mycelium — took *k* from `SecureRandom`. Repeated PRNG state means repeated *k*. Repeated *k* means, by the two-line algebra of §1.6, the private key.

The exploitation is what makes this story pedagogically special. The attacker does not need access to the phone, the app, or the user. **The blockchain is a public, permanent, globally replicated database of ECDSA signatures.** Scanning it for two signatures under the same public key with the same *r* is a `GROUP BY` over a column. Anyone could run it; several people did; funds were swept from affected addresses within hours of the disclosure. Estimates of the immediate loss run to a few tens of BTC — small in absolute terms and entirely beside the point, which is that the vulnerability window was *retroactive to every signature ever produced by an affected wallet*.

Google's advisory (Android Developers Blog, 14 August 2013) shipped a workaround requiring applications to explicitly reseed `SecureRandom` from `/dev/urandom`, and the underlying fix landed in 4.3+. The Bitcoin ecosystem's response was more interesting and more durable: **the wallet software moved to RFC 6979 deterministic nonces**, removing the RNG from the signing path entirely. `libsecp256k1`, which now backs Bitcoin Core and most wallets, generates *k* deterministically by default. The ecosystem did not fix its random number generator; it **eliminated its dependency on one**.

#### The pattern behind all three

Put the three side by side and the same shape appears:

| | Debian OpenSSL | Sony PS3 | Android/Bitcoin |
|---|---|---|---|
| Root cause | Entropy source removed | Nonce constant by design decision | PRNG unseeded / state shared across fork |
| Size of the defect | 2 commented-out lines | 1 constant | An initialisation ordering bug |
| Detectable by testing? | No — everything worked | No — signatures verified | No — output looked random |
| Blast radius | Every key on every Debian derivative for 20 months | Every PS3 signing key, permanently | Every signature ever made by an affected wallet |
| The structural fix | Mix multiple entropy sources | Deterministic nonces (RFC 6979 / EdDSA) | Deterministic nonces, again |

Three properties recur and are worth naming as a rule:

1. **The defect is small and local; the consequence is total and global.** There is no proportionality in cryptographic failure. This is unlike almost every other class of software bug and it is why the engineering discipline has to be different.
2. **No amount of testing finds it.** Every one of these systems passed its tests and worked in production for months or years.
3. **The durable fix removes the requirement rather than satisfying it better.** "Be more careful with your randomness" fixed none of these. "Do not need randomness here" fixed two of them outright. Whenever a design has a component whose failure is silent and catastrophic, the right move is to design the component out — this is the same instinct that produces AEAD (§2.8) instead of "remember to also MAC it", and X25519 (§3.6) instead of "remember to validate the point".

---

## 2. Symmetric cryptography

Symmetric crypto is where both parties hold the same key. It is fast — on modern hardware, faster than the memory bandwidth you can feed it (§6.1) — and it does essentially all of the actual work of protecting data. Asymmetric crypto exists almost entirely to establish the symmetric key.

### 2.1 Block ciphers as keyed permutations

A block cipher is a family of permutations. For each key *k* of *κ* bits, `E_k` is a **bijection** on the set of *n*-bit blocks:

```
E : {0,1}^κ × {0,1}^n → {0,1}^n
E_k = E(k, ·)   is a permutation of {0,1}^n, with inverse D_k
```

Bijectivity is not an aesthetic choice — it is forced. Decryption must recover the plaintext uniquely, so the map must be invertible for every key. This has an immediate and under-appreciated consequence: **a block cipher cannot compress and cannot expand.** *n* bits in, *n* bits out, always.

The security goal is that `E_k` for a random unknown *k* should be **indistinguishable from a random permutation** of the block space, to an adversary who may ask for encryptions and decryptions of blocks of their choosing (a *strong pseudorandom permutation*, PRP-CCA). This is a much stronger statement than "you cannot recover the key". It says no *structure* is observable at all: no pair of inputs whose outputs are related, no bias in any bit, no shortcut of any kind.

Three parameters, and the distinction between the first two matters:

| Parameter | AES | Consequence of it being small |
|---|---|---|
| **Key size** κ | 128 / 192 / 256 | Brute force costs 2^κ. 128 is out of reach classically; see §5 for the quantum caveat |
| **Block size** *n* | 128 bits (16 bytes) | **Birthday bound**: after ~2^(n/2) blocks, collisions appear and modes start leaking. For n=128 that is 2^64 blocks = 256 exabytes, comfortable. For n=64 (3DES, Blowfish) it is 2^32 blocks = **32 GB**, which is a working afternoon |
| **Rounds** | 10 / 12 / 14 | Security margin against cryptanalysis. Reduced-round AES *is* broken; full-round is not |

The 64-bit block size problem is not academic. **Sweet32** (Bhargavan & Leurent, CCS 2016) exploited exactly this against 3DES in TLS and Blowfish in OpenVPN: keep a long-lived connection alive, capture ~785 GB, find a CBC block collision, and recover plaintext — they demonstrated recovery of an HTTP session cookie. It is the reason 3DES was formally deprecated (NIST SP 800-131A Rev. 2 disallowed it for encryption after 2023) and the reason nobody should ship a 64-bit-block cipher today.

### 2.2 The substitution-permutation network

Shannon (1949) named the two operations a cipher needs:

- **Confusion** — the relationship between key and ciphertext should be complex. Achieved by **substitution**: a nonlinear lookup (an *S-box*).
- **Diffusion** — changing one plaintext bit should change roughly half the ciphertext bits, and the influence of each plaintext bit should be spread over the whole block. Achieved by **permutation/mixing**: a linear layer that moves bits around and combines them.

Neither is sufficient alone. Substitution alone is a monoalphabetic cipher on 8-bit symbols — trivially broken by frequency analysis. Permutation alone is linear, and **any purely linear cipher is broken by solving a linear system**, no matter how many rounds you stack, because the composition of linear maps is linear. You need both, alternating, many times.

A **substitution-permutation network** is the direct realisation of that: repeat *r* times over the block state:

```
AddRoundKey  (XOR in a round key derived from the master key)
Substitute   (apply a small nonlinear S-box to each chunk in parallel)
Permute/Mix  (a linear diffusion layer across the whole state)
```

The design question is how many rounds. Too few and differential/linear cryptanalysis wins; too many and you pay throughput for margin you cannot use. AES-128's 10 rounds were chosen with roughly a 4-round margin over the best attacks known at design time; twenty-five years later the best attacks on full AES-128 still recover a key in about 2^126 operations — a factor of four better than brute force, which is a cryptanalytic result and not a practical one.

The main structural alternative is the **Feistel network** (DES, Blowfish, Twofish): split the block in half, apply a round function to one half, XOR into the other, swap. Its appeal is that **the round function need not be invertible** — the Feistel structure is invertible regardless — which buys design freedom, at the cost of needing roughly twice as many rounds because each round only touches half the state. AES chose the SPN because it parallelises better in both hardware and SIMD software.

### 2.3 AES at implementable depth

AES is the Rijndael cipher (Daemen and Rijmen), selected by NIST in October 2000 after a five-year open competition and standardised as **FIPS 197** in November 2001. FIPS 197 was reaffirmed with editorial updates in **May 2023**. It is the most analysed cipher in history and the most implemented; every claim below is from FIPS 197 itself, which is short, free, and the correct document to implement from.

#### The state

AES operates on a **128-bit state** viewed as a 4×4 matrix of bytes, filled **column-major**:

```
input bytes  b0 b1 b2 ... b15
                                     ┌ b0  b4  b8  b12 ┐
state[r][c] = b[r + 4c]              │ b1  b5  b9  b13 │
                                     │ b2  b6  b10 b14 │
                                     └ b3  b7  b11 b15 ┘
```

Column-major is the single most common source of "my AES produces wrong bytes but is self-consistent" — it round-trips perfectly while failing every test vector, which is §1.4 reason 2 in miniature.

#### The field GF(2^8)

Bytes are elements of the finite field GF(2^8) = GF(2)[x]/(m(x)) with the fixed irreducible polynomial

```
m(x) = x^8 + x^4 + x^3 + x + 1      (0x11B)
```

Addition is XOR. Multiplication is polynomial multiplication modulo *m(x)*, which in code is the "Russian peasant" loop with a conditional reduction:

```c
uint8_t gmul(uint8_t a, uint8_t b) {
    uint8_t p = 0;
    for (int i = 0; i < 8; i++) {
        if (b & 1) p ^= a;
        uint8_t hi = a & 0x80;
        a <<= 1;
        if (hi) a ^= 0x1B;      /* reduce mod 0x11B */
        b >>= 1;
    }
    return p;
}
```

Note the `if (b & 1)` and `if (hi)`: written this way the function is **not constant-time**, and on a secret operand that is a bug. §6.4 shows the branchless form. In AES proper, `gmul` is only ever applied with *constant* multipliers (2 and 3 in MixColumns), so the usual implementation replaces it with `xtime` and a table — but the habit of noticing the branch is the point.

#### The four round operations

**SubBytes** — apply the AES S-box to each of the 16 bytes independently. The S-box is *not* an arbitrary table; it is defined algebraically as

```
S(a) = A · a^(-1) + 0x63       (inverse in GF(2^8), with 0 → 0, then an affine map over GF(2))
```

The multiplicative inverse gives excellent nonlinearity (the best possible differential uniformity for a byte permutation of this form: maximum differential probability 4/256, maximum linear bias 16/256). The affine map afterwards exists specifically to destroy the algebraic simplicity of the inverse — without it, the S-box would have a very compact algebraic description and would fix 0 and 1. This is a genuinely instructive design decision: the nonlinearity comes from the algebra, and then an extra step is bolted on **to hide the algebra**. In practice everyone ships the 256-byte table; generating it from the definition is a good exercise and a good way to be sure you understand the field.

**ShiftRows** — cyclically left-shift row *r* by *r* bytes (row 0 unchanged, row 1 by 1, row 2 by 2, row 3 by 3). Pure byte movement, no arithmetic. Its job is inter-column diffusion: without it, AES would be four independent 32-bit ciphers running in parallel, and each column could be attacked separately.

**MixColumns** — treat each column as a polynomial over GF(2^8) and multiply by the fixed polynomial `03·x³ + 01·x² + 01·x + 02`, equivalently the circulant matrix

```
┌ 02 03 01 01 ┐
│ 01 02 03 01 │
│ 01 01 02 03 │
└ 03 01 01 02 ┘
```

This is an **MDS matrix**: together, ShiftRows and MixColumns guarantee that any two-round difference activates at least 5 S-boxes (the *wide trail strategy*, which is Rijndael's central design argument and how the round count was justified). MixColumns is **omitted in the final round** — a fact that trips up every first implementation. It is omitted because it buys no security at the end (it is linear and publicly invertible, so an attacker can simply undo it) and omitting it makes the decryption circuit structurally symmetric to encryption.

**AddRoundKey** — XOR the 128-bit round key into the state. This is the only place the key enters, which is why the key schedule is load-bearing.

#### The key schedule

AES-128 expands a 16-byte key into **11** round keys (one before the first round, one per round), i.e. 44 32-bit words:

```
W[0..3] = the key
for i in 4..43:
    temp = W[i-1]
    if i % 4 == 0:
        temp = SubWord(RotWord(temp)) XOR Rcon[i/4]
    W[i] = W[i-4] XOR temp
```

`RotWord` rotates a word left by one byte, `SubWord` applies the S-box to each byte, and `Rcon[j] = (x^(j-1), 0, 0, 0)` in GF(2^8) — so `Rcon` runs 01, 02, 04, 08, 10, 20, 40, 80, 1B, 36 for the ten rounds, and the 1B is where the field reduction shows up in the constants. AES-192 and AES-256 have slightly different schedules (AES-256 applies `SubWord` at an extra position); FIPS 197 gives all three.

The round structure in full, AES-128:

```
AddRoundKey(state, W[0..3])
for round = 1..9:
    SubBytes; ShiftRows; MixColumns; AddRoundKey(state, W[4*round .. 4*round+3])
SubBytes; ShiftRows; AddRoundKey(state, W[40..43])       # no MixColumns
```

That is the whole cipher. It is about 150 lines of C with the tables inline, and writing it against the FIPS-197 vectors (§7, Unit 1) is the single most useful afternoon in this entire document.

#### The T-table implementation, and why it is a liability

The classical fast software AES folds SubBytes, ShiftRows and MixColumns into **four 1 KB lookup tables** (`T0..T3`), turning each round into 16 table lookups and 16 XORs. It is elegant and it was the standard implementation for a decade.

It is also **the canonical cache-timing vulnerability**. The table index is `plaintext_byte XOR key_byte`, so which cache line is touched depends on secret key material, and an attacker who can observe cache state — co-resident process, hyperthread sibling, or even a remote attacker measuring response times — recovers the key. Bernstein demonstrated a remote key recovery against a table-based AES server in 2005; Osvik, Shamir and Tromer's "Cache Attacks and Countermeasures" (2006) recovered a full key with 65 milliseconds of measurement in the strongest setting. The details of the attack belong to `hardware-security.md`; the consequence belongs here:

**The fast, obvious, textbook AES implementation is broken by construction on any shared machine.** The responses were (a) bitslicing — represent the state transposed across registers so that all operations are bitwise and no table is indexed by a secret, at a significant complexity cost but with constant time by construction; and (b) putting AES in the instruction set (§6.1), which is what actually won. When AES-NI exists, use it; when it does not, use a bitsliced or vector-permute implementation; **never ship T-tables**.

### 2.4 Modes of operation, taught by their failure modes

A block cipher encrypts exactly 128 bits. Everything else — messages of arbitrary length, streams, packets — is the **mode of operation**, and this is where essentially all deployed cryptographic failure happens. The primitive is not the problem. The composition is.

The sections that follow deliberately introduce each mode through the attack that discredited it.

### 2.5 ECB, and the penguin

**Electronic Codebook**: split the plaintext into blocks, encrypt each independently.

```
C_i = E_k(P_i)
```

The failure is immediate from the definition: `E_k` is a deterministic function, so **identical plaintext blocks produce identical ciphertext blocks**. Every structural repetition in the plaintext survives into the ciphertext.

The canonical demonstration is the **ECB penguin**: take the Linux mascot as a bitmap, encrypt the pixel data with AES-ECB, and view the result as an image. The penguin is still perfectly visible. The colours are noise; the *shape* — every region of uniform colour maps to a repeated ciphertext block — is untouched. It is on the Wikipedia "Block cipher mode of operation" page and it has taught more people what "leaks structure" means than any proof.

The mechanised version of the same lesson, which is what §7's Unit 1 exercise asserts:

```c
/* two identical 16-byte plaintext blocks */
uint8_t pt[32] = {0};  memcpy(pt, "YELLOW SUBMARINE", 16); memcpy(pt+16, "YELLOW SUBMARINE", 16);
aes128_ecb_encrypt(key, pt, ct, 32);
assert(memcmp(ct, ct + 16, 16) == 0);   /* THE BUG, as a passing assertion */
```

That assertion passing *is* the vulnerability. Writing the test that way — asserting the leak rather than describing it — is the pedagogically important move.

**Real consequences beyond the picture.** ECB is not merely "leaks a bit of structure":

- **Block reordering and splicing.** Blocks are independent, so an attacker can reorder, duplicate or delete them and the result still decrypts. Encrypted database columns in ECB can be swapped between rows.
- **Chosen-plaintext byte-at-a-time decryption.** If an attacker can prefix their own data to a secret (a cookie, say) and see the ECB ciphertext, they recover the secret one byte at a time by aligning it at a block boundary and building a dictionary of 256 candidate blocks. This is Cryptopals challenge 12 and it takes about forty lines of Python.
- **It is still deployed.** ECB has repeatedly turned up in shipping products — Zoom's May 2020 "AES-256" turned out to be AES-128-**ECB** (Citizen Lab, April 2020), and it appears constantly in embedded firmware and enterprise applications where someone reached for `EVP_aes_128_ecb` because it was the one that did not need an IV.

**The rule: ECB has no correct use for messages.** The single-block case (encrypting exactly one block of already-random data, e.g. a key-wrapping primitive built on top) is a different construction with its own name. If your API offers ECB, it is offering a footgun for compatibility reasons.

### 2.6 CBC, and the padding oracle

**Cipher Block Chaining** fixes ECB's determinism by chaining:

```
C_0 = IV                       (random, unpredictable, per message)
C_i = E_k(P_i XOR C_{i-1})
P_i = D_k(C_i) XOR C_{i-1}
```

Each ciphertext block depends on all preceding plaintext, so identical blocks no longer repeat and the penguin disappears. CBC was the default mode for decades and is still everywhere in legacy systems.

It has three problems, in increasing order of severity.

**Problem 1: the IV must be unpredictable, not merely unique.** If an attacker can predict the IV of the *next* message and can choose part of that message, they can test guesses about earlier plaintext. This is exactly **BEAST** (Duong & Rizzo, 2011) against TLS 1.0, which used the previous record's last ciphertext block as the next record's IV — trivially predictable by anyone watching the wire. TLS 1.1 fixed it by giving each record an explicit random IV.

**Problem 2: it is inherently serial for encryption.** `C_i` needs `C_{i-1}`, so encryption cannot be pipelined across blocks — a hard throughput ceiling that CTR and GCM do not have (decryption *is* parallelisable, since all `C_i` are known up front).

**Problem 3, the fatal one: padding.** CBC needs the plaintext to be a whole number of blocks, so it is padded — universally with **PKCS#7**: append *N* bytes each of value *N*, where *N* ∈ [1,16] is whatever makes the length a multiple of 16 (and a full block of `10 10 ... 10` if it already is). On decryption the receiver checks the padding is well-formed and strips it.

That check is the vulnerability. Vaudenay (EUROCRYPT 2002) observed that if the receiver behaves **observably differently** for "bad padding" versus "good padding but bad MAC" — a different error code, a different message, or merely a different *response time* — then the receiver is an oracle answering the question "is this padding valid?", and that single bit is enough to decrypt arbitrary ciphertext.

The mechanism, which is worth working through by hand once:

```
Attacker holds ciphertext blocks (C_{i-1}, C_i) and wants P_i.
Submit (C', C_i) with C' attacker-controlled.
Receiver computes P' = D_k(C_i) XOR C'.
Vary the last byte of C' over all 256 values until the oracle says "padding OK".
That almost always means P' ended in 0x01, so:
    D_k(C_i)[15] = C'[15] XOR 0x01
and since  P_i[15] = D_k(C_i)[15] XOR C_{i-1}[15],  the byte falls out.
Then target 0x02 0x02 for the next byte, and so on.
```

**256 queries per byte, 16 bytes per block, no key recovery required.** The attacker never learns the key; they do not need to.

The history of this one attack is the history of TLS's record layer:

| Attack | Year | Oracle |
|---|---|---|
| Vaudenay's original | 2002 | Distinct error messages in SSL/TLS implementations |
| **Lucky 13** (AlFardan & Paterson) | 2013 | *Timing*. TLS's MAC-then-Encrypt meant the HMAC computation ran over a length that depended on the padding, producing a few-microsecond difference. The "fixed" constant-time-ish code was still exploitable |
| **POODLE** | 2014 | SSL 3.0's padding, whose content bytes are unspecified and therefore uncheckable — downgrade to SSLv3, then decrypt. Killed SSL 3.0 outright |
| **DROWN** | 2016 | An SSLv2 server sharing a key with a TLS server acts as an oracle *for the TLS server* |
| **Zombie POODLE / GOLDENDOODLE** | 2019 | Implementations that "fixed" padding oracles but still leaked via subtly different behaviour |

The eleven-year tail from Vaudenay to Lucky 13 to Zombie POODLE is the single most convincing argument in this document for §1.4: **this attack was published, understood, and specifically defended against, and implementations kept being vulnerable anyway**, because the defence requires the decrypt path to be constant-time over a data-dependent length, which is genuinely hard to write and impossible to verify by testing.

**Two lessons, and the second is the general one.**

1. Never distinguish padding failure from authentication failure — not in the error code, not in the timing, not in the log.
2. **The real fix is structural: authenticate the ciphertext before touching it.** With Encrypt-then-MAC (§2.9) the tag is checked over the raw ciphertext, and a modified ciphertext is rejected before the padding is ever examined — there is nothing for the oracle to answer. With a proper AEAD (§2.8) this is not something you have to remember to do. This is the §1.6 pattern again: the durable fix removes the requirement rather than satisfying it more carefully.

### 2.7 CTR, and the absolute nonce prohibition

**Counter mode** turns a block cipher into a stream cipher. The cipher is never applied to the plaintext at all; it generates a keystream, which is XORed in:

```
keystream_i = E_k(nonce || counter_i)
C_i = P_i XOR keystream_i
```

The properties are excellent:

- **Parallel** in both directions — every block's keystream is independent, so it vectorises and pipelines perfectly (this is why AES-CTR and AES-GCM hit the numbers in §6.1 and CBC does not).
- **Random access** — decrypt block 10^6 without touching the others. This is why it is the mode for disk and database encryption.
- **No padding**, so no padding oracle; the ciphertext is exactly the plaintext's length.
- **Only the encryption direction of the cipher is needed** — `D_k` is never called, which halves the code and the hardware.

And one requirement that admits **no exceptions whatsoever**:

> **A (key, nonce) pair may be used to produce keystream exactly once. Ever.**

Because if it is used twice:

```
C₁ = P₁ XOR KS
C₂ = P₂ XOR KS
C₁ XOR C₂ = P₁ XOR P₂          ← the key is gone from the equation
```

This is a **two-time pad**, and it is the VENONA failure from §1.5 reproduced exactly. `P₁ XOR P₂` is recoverable by crib-dragging: guess a plausible fragment of `P₁` at some offset, XOR it in, and see whether the corresponding stretch of `P₂` is plausible English/JSON/protocol data. For structured plaintext it is nearly automatic; for natural language it is a pleasant puzzle; with three or more messages under the same keystream it is trivial. And if the attacker *knows* one plaintext — a fixed header, a predictable field — the other falls out directly with no guessing at all. §7's Unit 2 exercise is exactly this, mechanised.

Note carefully what is *not* required: the nonce need not be secret, and it need not be random. It is normally sent in the clear alongside the ciphertext. **Unique is the whole requirement.**

The practical failure modes, all of which have shipped:

- **A random 64-bit nonce.** By the birthday bound you expect a collision after ~2^32 messages. That sounds like a lot until it is a busy service. This is why 96-bit nonces are the norm and why 64-bit random nonces are a design smell.
- **A counter that resets.** Persist the counter, then restore from a backup, or reboot a device whose counter lived in RAM, or restore a VM snapshot — and the nonce sequence replays. **Snapshot/restore is the modern version of this bug and it is not solved by careful coding.**
- **A counter that resets per-connection while the key does not.** Rekey when you reset, always.
- **The counter overflowing into the nonce field.** If nonce and counter share a 128-bit block and you do not bound the message length, a long message's counter can walk into the next message's nonce space.
- **Two senders, one key.** Both sides of a duplex channel using the same key with independently-chosen nonces will collide. The fix is directional keys: derive a separate key per direction, which is exactly what TLS 1.3 (§4.2) and the Signal ratchet (§4.3) do.

**The counter/nonce split as deployed.** The standard layout for a 128-bit block is **96-bit nonce ‖ 32-bit counter**, which caps a single message at 2^32 blocks = 64 GB and gives room for a random or sequential nonce. That is the layout AES-GCM mandates and the reason GCM's nonce is 96 bits.

### 2.8 AEAD: making authentication non-optional

Every mode so far provides confidentiality and *nothing else*. §1.1 said that is a bug. Two decades of attacks — padding oracles, BEAST, malleability of CTR — say the same thing louder. The response, from about 2000 onward, is **Authenticated Encryption with Associated Data**.

An AEAD is a single primitive with one interface:

```
seal(key, nonce, plaintext, associated_data) -> ciphertext || tag
open(key, nonce, ciphertext || tag, associated_data) -> plaintext  OR  FAILURE
```

Three properties matter:

- **Authentication is not a separate call you can forget.** You cannot get plaintext out without the tag verifying. There is no API through which "encrypt but don't authenticate" is expressible.
- **Associated data** is authenticated but not encrypted — for headers that must be routable in the clear but must not be tamperable: packet numbers, sequence numbers, an S3 object key, a message type field. This is a genuinely useful capability that people underuse and then re-implement badly.
- **Failure is a single, indistinguishable, atomic FAILURE.** No "bad padding" vs "bad MAC" distinction exists to leak, and no plaintext is released before verification. (The last part is a real implementation obligation: a streaming AEAD API that hands you plaintext before the tag is checked has handed you a padding oracle in a new costume. This is why the Encrypt-then-MAC ordering and the "do not use decrypted data before verifying" rule are stated separately in every AEAD spec.)

**AES-GCM** is the workhorse: AES-CTR for confidentiality plus **GHASH**, a polynomial evaluation MAC over GF(2^128), for authentication. Standardised in NIST SP 800-38D (2007). It is the default in TLS 1.2 and 1.3, IPsec, SSH and almost everything else, for the mundane and decisive reason that both halves have dedicated instructions on every modern CPU: AES-NI for the counter mode and **PCLMULQDQ** for GHASH (§6.2). AES-GCM at ~0.6 cycles/byte is not a cryptographic achievement, it is a hardware one.

**GHASH, and why it fails so badly.** GHASH evaluates a polynomial whose coefficients are the ciphertext blocks, at the point *H = E_k(0^128)* — the *authentication key*, derived from the block cipher key:

```
GHASH_H(A, C) = ((...((A₁·H ⊕ A₂)·H ⊕ ...) ⊕ C_m)·H ⊕ len(A)‖len(C)) · H
tag = GHASH_H(A, C) XOR E_k(nonce || 1)
```

All arithmetic in GF(2^128) with the reduction polynomial `x^128 + x^7 + x^2 + x + 1`.

Now the catastrophe. GHASH is a *polynomial* MAC, and polynomial MACs are only secure while the evaluation point is unknown. **Repeat a nonce under the same key and you get two tags computed with the same H over known ciphertexts.** Subtracting the two tag equations cancels the `E_k(nonce‖1)` blinding term and leaves a polynomial in H over GF(2^128) whose roots you can compute. The attacker recovers **H**.

With H, the attacker can **forge a valid tag for any message of their choosing**, forever, under that key. Contrast this with CTR nonce reuse, which loses the confidentiality of the two affected messages: **GCM nonce reuse loses the integrity of the entire key, permanently.** It is a strictly worse failure, and the practical distinction to teach is:

| | CTR nonce reuse | GCM nonce reuse |
|---|---|---|
| What leaks | P₁ XOR P₂ for the affected pair | The authentication key H |
| Scope | Those two messages | **Every message under that key, past and future** |
| Recovery | Rekey; old messages already exposed | Rekey; all prior authentication is void |

This is not theoretical. Böck, Zauner, Devlin, Somorovsky and Jovanovic's "Nonce-Disrespecting Adversaries" (WOOT 2016) scanned the internet for **TLS servers that repeated GCM nonces**, found a number of them (including devices from major vendors with a broken nonce generator that used a counter reset per connection while the key persisted), and demonstrated live forgery — injecting arbitrary content into HTTPS sessions.

GCM has a second, milder sharp edge worth knowing: **truncated tags are much weaker than their length suggests.** Ferguson (2005) showed that GCM with short tags admits forgeries at a cost far below 2^t, and repeated forgery attempts leak information about H. Do not truncate GCM tags below 128 bits.

**ChaCha20-Poly1305** is the other modern default, and it exists largely because of §6.1: on a CPU *without* AES instructions — most phones before ARMv8, most low-end embedded — a constant-time AES is either slow or complicated, while ChaCha20 is fast and constant-time by construction.

ChaCha20 (Bernstein, 2008, refined from Salsa20) is an **ARX** design: the only operations are Add (mod 2^32), Rotate, and XOR. Every one of those is a single-cycle, fixed-latency instruction on every CPU ever built, with **no lookup tables and no data-dependent branches**. Constant-time is not a discipline you apply to ChaCha20; it is a property of the operations it is built from. That is a design decision with the same shape as the ones in §1.6's summary: rather than requiring implementers to be careful, remove the opportunity to be careless.

The structure: a 4×4 matrix of 32-bit words = constants "expa nd 3 2-by te k" ‖ 256-bit key ‖ 32-bit counter ‖ 96-bit nonce; 20 rounds alternating column-rounds and diagonal-rounds of the quarter-round

```
a += b; d ^= a; d <<<= 16;
c += d; b ^= c; b <<<= 12;
a += b; d ^= a; d <<<=  8;
c += d; b ^= c; b <<<=  7;
```

then add the original matrix back (making the core non-invertible, which is what lets it be used as a stream generator rather than a block cipher). Poly1305 is a different polynomial MAC — evaluation modulo the prime **2^130 − 5**, chosen because it is fast with 64-bit multiplies. RFC 8439 (June 2018) specifies the AEAD combination. It shares GCM's nonce-reuse sensitivity for the MAC key, so the rule is identical.

Google's 2014 deployment of ChaCha20-Poly1305 in Chrome on Android was the demonstration case: roughly 3× the throughput of AES-GCM on ARM devices without crypto extensions, which mattered enormously for battery and latency on the phones of the day. As ARMv8 crypto extensions became universal the gap narrowed, and today AES-GCM usually wins on the hardware that has AES-NI/ARMv8-CE — but ChaCha20-Poly1305 remains the right answer whenever you cannot be sure, and both are in TLS 1.3's mandatory set precisely so the client can pick based on its own hardware. **Chrome and Firefox pick per-device: they offer AES-GCM first if the CPU reports AES support and ChaCha20 first if it does not.**

**AES-GCM-SIV** (RFC 8452, April 2019) is the "you will eventually reuse a nonce" answer. SIV = Synthetic IV: instead of taking the nonce as the sole input to the counter, **derive the counter's starting value from a MAC of the plaintext itself** (with POLYVAL, a GHASH variant, and per-nonce derived keys). The consequences:

- It is **nonce-misuse resistant**: repeating a nonce with *different* plaintexts leaks nothing beyond the fact that the plaintexts differ. Repeating a nonce with the *same* plaintext produces the same ciphertext, which reveals only that the messages were equal — the minimum leakage any deterministic scheme can have.
- The cost is that it is **two-pass**: you must read the whole plaintext to compute the synthetic IV before you can encrypt any of it. That rules it out for true streaming and costs roughly 30–50% throughput versus GCM.

The engineering judgement: use AES-GCM when you can *prove* your nonces are unique (a counter you control, in a system with no snapshot/restore path); use AES-GCM-SIV when nonce uniqueness depends on something you do not fully control — distributed senders, a stateless service, client devices, anything that can be restored from a backup. **"We are sure our nonces are unique" has been wrong often enough that the existence of GCM-SIV is a reasonable default rather than a paranoid one.**

Also worth knowing: **XChaCha20-Poly1305** (libsodium's default, and an IETF draft rather than an RFC) extends the nonce to 192 bits by first deriving a subkey with HChaCha20. At 192 bits, a **randomly generated** nonce has negligible collision probability (birthday bound 2^96), which means you can stop managing nonce state entirely and just generate one per message. That is often the most robust engineering answer available, and it is the reason libsodium's `crypto_secretbox_easy` is hard to misuse.

**The recommendation, stated plainly (September 2026):**

| Situation | Use |
|---|---|
| General purpose, hardware AES available, nonces provably unique | **AES-256-GCM** |
| General purpose, no AES instructions, or unknown hardware | **ChaCha20-Poly1305** |
| Nonce uniqueness not guaranteeable | **AES-GCM-SIV** or **XChaCha20-Poly1305** |
| You are choosing a mode without authentication | You are not. Go back. |

### 2.9 Encrypt-then-MAC, and why the order is not a matter of taste

If you must compose a cipher and a MAC by hand — legacy protocol, constrained environment, or an exercise — there are three orderings and only one is right. Bellare and Namprempre (ASIACRYPT 2000) settled this formally; the informal version:

| Order | Construction | Verdict |
|---|---|---|
| **Encrypt-then-MAC** | `C = Enc(K1, P)`, `T = MAC(K2, C)`, send `C‖T`. Verify T over C, then decrypt | **Correct.** Generically secure: a secure cipher plus a secure MAC always gives a secure AEAD |
| **MAC-then-Encrypt** | `T = MAC(K2, P)`, `C = Enc(K1, P‖T)` | Not generically secure. **This is what SSL/TLS did**, and it is the direct enabler of every padding oracle in §2.6 — you must decrypt (and unpad) before you can check the tag |
| **Encrypt-and-MAC** | `C = Enc(K1, P)`, `T = MAC(K2, P)`, send `C‖T` | Worst. The tag is over the *plaintext*, so identical plaintexts produce identical tags — the MAC leaks plaintext equality. **This is what SSH did** |

Three rules that come with it, each of which has its own CVE history:

1. **Independent keys.** `K1 ≠ K2`, and they should be derived from a master secret by a KDF (§2.11), not by "use the same key for both" or "use the key and its complement".
2. **MAC everything on the wire**, including the IV/nonce and any length or version fields. An unauthenticated IV in CBC lets an attacker flip arbitrary bits of the first plaintext block.
3. **Compare tags in constant time.** `memcmp` returns early on the first differing byte, which turns tag comparison into a byte-at-a-time oracle: an attacker submits forgeries and times the rejection, learning the correct tag one byte at a time in 256×16 attempts instead of 2^128. This is §6.4's technique and §7.3's exercise, and it is the most common single crypto bug in application code.

And the meta-rule: **do not do this.** Use an AEAD. Encrypt-then-MAC is what you need to *understand* so that you can recognise what an AEAD is doing for you, and so that you can read a legacy protocol.

### 2.10 Stream ciphers

A stream cipher generates a keystream from a key and nonce and XORs it in. CTR mode turns any block cipher into one; native stream ciphers skip the block cipher.

**RC4** is the historically important one and the cautionary tale: adopted everywhere (WEP, WPA-TKIP, TLS, Skype) because it was tiny and fast, and dismantled over fifteen years. Fluhrer–Mantin–Shamir (2001) exploited key-scheduling weaknesses to break **WEP** outright, recovering the network key from passive capture. Then AlFardan, Bernstein, Paterson, Poettering and Schuldt (2013) showed the keystream's **statistical biases** — the second output byte is 0 with probability 2/256 rather than 1/256, and there are biases throughout the first few hundred bytes — let an attacker recover a repeatedly-sent plaintext (an HTTP cookie) from enough sessions. RC4 was prohibited in TLS by **RFC 7465 (February 2015)**.

The lesson to extract: RC4 was not broken by one dramatic attack. It was **eroded** — biases found, then exploited more efficiently, then made practical — over more than a decade, while remaining "fine in practice" at each step. Crypto ages in one direction, and "no practical attack yet" is a statement about the present tense only. This is the argument for migrating *before* you are forced to, and it is the same argument §5 makes about post-quantum.

**ChaCha20** is the modern one (§2.8): ARX, no tables, constant-time by construction, better diffusion per round than Salsa20, 20 rounds with a large margin. Also worth knowing: the **eSTREAM** portfolio (2008) selected Salsa20/12, HC-128, Rabbit and SOSEMANUK for software; almost nobody uses them, because ChaCha20 won on the merits and on Google's deployment.

Two structural warnings about stream ciphers in general:

- **They are the most malleable construction in cryptography.** Bit *i* of ciphertext controls bit *i* of plaintext, exactly. Without a MAC, an attacker with any knowledge of the plaintext format edits it at will — flipping `"admin":false` to `"admin":true0` if the lengths cooperate. Never unauthenticated.
- **The keystream is a resource that must never be re-issued.** §2.7's rule, restated.

### 2.11 KDFs: HKDF and the extract-then-expand discipline

A **key derivation function** turns key material into more key material with the right properties. The three jobs it does are distinct and conflating them is a bug:

1. **Extract** — take a source with entropy that is *not uniformly distributed* (a Diffie-Hellman shared secret is a curve point or a group element, not a uniform bit string; it has structure and bias) and concentrate it into a uniformly random key.
2. **Expand** — take one uniform key and produce many independent keys.
3. **Separate** — bind each derived key to a context so that keys used for different purposes cannot be confused, even if the same input keying material is used in two protocols.

**HKDF** (Krawczyk, RFC 5869, May 2010) is the standard construction and it is exactly extract-then-expand:

```
PRK       = HKDF-Extract(salt, IKM)  = HMAC(key=salt, msg=IKM)
OKM       = HKDF-Expand(PRK, info, L):
              T(0) = ""
              T(i) = HMAC(PRK, T(i-1) || info || byte(i))
              OKM  = first L bytes of T(1) || T(2) || ...
```

The `info` parameter is the underrated one. It is the **context/label string**, and using it correctly ("tls13 c ap traffic", "handshake key", "client write iv") is what makes two derived keys provably independent. Domain separation is cheap, it costs one string, and its absence is the root of a surprising number of cross-protocol attacks. TLS 1.3's entire key schedule (§4.2) is HKDF with carefully chosen labels, and Signal's ratchet (§4.3) is HKDF applied repeatedly.

The distinction that matters most in practice:

> **A KDF is for high-entropy inputs. A password hash is for low-entropy inputs. They are not interchangeable, in either direction.**

Running HKDF on a password is a serious bug: HKDF is *deliberately fast*, so it hands the attacker a cheap guess-verification oracle. Running Argon2 on a Diffie-Hellman shared secret is merely wasteful — but it is also not what it is for. The next section is the other half.

### 2.12 Password hashing and the memory-hardness argument

Passwords are the pathological input: chosen by humans, drawn from a distribution with maybe 20–30 bits of real entropy, and reused across sites. Any function that maps them to a stored value can be attacked by **guessing**, and the only defence is to make each guess expensive.

Three requirements, in the order they were historically understood:

**Salt** — a unique random value per password, stored alongside the hash. Without it, identical passwords have identical hashes (so a breach reveals which users share a password), and one precomputed table — a rainbow table — breaks every account in every database simultaneously. With a 16-byte salt, precomputation is dead: the attacker must attack each password individually. Salts are not secret and do not need to be.

**Slowness (work factor)** — a tunable cost so that verifying one password takes, say, 100 ms on your server. Legitimate login: unnoticeable. Attacker with a stolen database: 10 guesses/second/core instead of billions. This is why a fast hash is precisely the wrong tool. **SHA-256 is not a password hash**, and neither is a thousand rounds of it that you wrote yourself.

**Memory hardness** — the modern requirement, and the one that needs the argument spelled out.

#### Why slowness alone stopped being enough

bcrypt's cost is CPU time. But the attacker does not have your CPU. They have:

| Attacker hardware | Advantage on a CPU-bound hash |
|---|---|
| GPU (thousands of simple cores) | 100–1000× |
| FPGA | Higher, at better performance-per-watt |
| ASIC | 10,000×+, and Bitcoin proved the economics of building one |

A hash that is only *slow* is slow **on your hardware**; the attacker parallelises it across hardware built for exactly this. As of 2026 a single high-end GPU does on the order of 10^10 unsalted SHA-256 guesses per second. The economics of the defence are lost.

The insight (Percival, 2009, in the scrypt paper) is that **silicon is cheap and memory is expensive**. Arithmetic units are tiny; a GPU has thousands. RAM is large, power-hungry, and does not shrink with process node the way logic does. So: design a function that *requires* a large working set with *random access*, and the attacker's parallelism advantage collapses — running 10,000 instances in parallel now requires 10,000 × 64 MB = 640 GB of fast memory, and the die area and bandwidth for it. Memory-hardness converts the defence from "how many operations per second can they do" to "how many megabytes can they buy", which is a much better exchange rate for the defender.

#### The three you may use

| | Year | Cost parameters | Notes |
|---|---|---|---|
| **bcrypt** | 1999 (Provos & Mazières, USENIX) | Cost factor (log₂ iterations) | Blowfish-based, uses ~4 KB of state — not memory-hard by modern standards, but the 4 KB was enough to be awkward on 1999-era hardware and is still awkward for GPUs relative to SHA-256. **Truncates the password at 72 bytes** — a real footgun with passphrases and with pre-hashing schemes. Still acceptable; still widely deployed |
| **scrypt** | 2009 (Percival) | N (memory/CPU cost), r (block size), p (parallelism) | First deliberately memory-hard design. RFC 7914. Sequential-memory-hard: computes a large array then accesses it in a data-dependent order |
| **Argon2** | 2015 | m (memory KiB), t (iterations), p (lanes) | **Winner of the Password Hashing Competition (July 2015)**. RFC 9106 (September 2021). The current default |

**Argon2's three variants**, and picking between them is a genuine decision:

- **Argon2d** — data-*d*ependent memory access. Maximally resistant to time-memory trade-off attacks, but the access pattern depends on the secret, so it leaks through cache side channels. For settings with no untrusted co-tenant — cryptocurrencies, local disk encryption.
- **Argon2i** — data-*i*ndependent access. Side-channel resistant, slightly weaker against TMTO attacks. For server-side password hashing where an attacker may share the machine.
- **Argon2id** — **the recommended default.** First half of the first pass data-independent, then data-dependent. Gets most of both properties. RFC 9106 says: *"If you do not know the difference between them or you consider them equally suitable, choose Argon2id."*

**Parameters, September 2026.** RFC 9106's recommendations remain the reference point: a first-choice setting of **t=1, m=2^21 (2 GiB), p=4**, and a second-choice of **t=3, m=2^16 (64 MiB), p=4** for memory-constrained environments. In practice most web deployments land nearer the second — OWASP's Password Storage Cheat Sheet has recommended **m=19 MiB, t=2, p=1** for Argon2id as a minimum floor, which is a *floor* and not a target. The right method is empirical: **tune the parameters on your production hardware until verification takes the longest time your login latency budget tolerates** (100 ms is a common choice; 250 ms is defensible), and re-tune every couple of years. Any number written in a document is out of date; the procedure is not. *(Parameter figures here are as published by RFC 9106 and OWASP as of this research date; treat the exact OWASP floor as **[unverified for late-2026 revisions]**.)*

**The rest of the discipline**, briefly, because password storage is where the primitive is the easy part:

- **Rehash on login** when you raise the cost factor — you have the plaintext password exactly once, at that moment.
- **Never truncate, never pre-hash into bcrypt with raw binary** (a base64 or hex pre-hash avoids both the 72-byte truncation and the NUL-byte truncation bug that has bitten several frameworks).
- **Compare in constant time** — the same rule as §2.9.
- **A "pepper"** (a secret key held outside the database, mixed in via HMAC before hashing) adds real defence against a database-only breach, at the cost of a key-rotation problem. Worth it for high-value systems.
- **The best password hash is fewer passwords.** Passkeys/WebAuthn (§4.5) remove the shared secret entirely and are the direction of travel.

---

## 3. Asymmetric cryptography

### 3.1 What the asymmetric idea buys, and what it costs

Symmetric crypto has one structural problem: **you must already share a key**. For *n* parties that is *n(n−1)/2* keys, every one of which had to be delivered by some out-of-band channel. Public-key cryptography (Diffie & Hellman, "New Directions in Cryptography", IEEE Trans. IT, November 1976; and independently at GCHQ by Ellis, Cocks and Williamson in 1969–1974, classified until 1997) breaks that: each party has a **key pair**, publishes half of it, and keeps half.

Everything asymmetric rests on a **trapdoor**: a function easy to compute and hard to invert, *unless* you hold a secret. Two families carry essentially all deployed cryptography:

| Family | Easy direction | Hard problem | Used by |
|---|---|---|---|
| **Factoring** | multiply two primes | factor the product | RSA |
| **Discrete log** | exponentiate in a group | recover the exponent | DH, DSA, ElGamal, ECDH, ECDSA, EdDSA |

Both fall to a sufficiently large quantum computer (§5). Both are also **thousands of times slower** than symmetric primitives — an X25519 operation is ~50–100 µs of work where AES-GCM moves a gigabyte in that time. So the deployed pattern everywhere, without exception, is:

> **Use asymmetric crypto once, to agree on a symmetric key. Then use symmetric crypto for the data.**

This is called a *hybrid cryptosystem* and it is what TLS, SSH, PGP, Signal, and every disk encryption scheme actually do. If you find yourself RSA-encrypting a megabyte, you have misunderstood the architecture.

### 3.2 Diffie-Hellman

Two parties who have never met agree on a shared secret over a channel an adversary is reading in full. It remains, fifty years later, the most surprising result in the field.

Public parameters: a large prime *p* and a generator *g* of a subgroup of Z*_p.

```
Alice: secret a,  sends  A = g^a mod p
Bob:   secret b,  sends  B = g^b mod p
Alice computes  B^a = g^(ba)  mod p
Bob   computes  A^b = g^(ab)  mod p        ← the same value
Eve sees p, g, A, B — and must solve the discrete log to get a or b
```

The shared value is **not** used as a key directly. It is a group element with structure and bias, so it goes through a KDF (§2.11) — this is precisely the "extract" job HKDF exists for.

**Three things that must be right, all of which have been wrong in production:**

1. **DH gives you a shared secret with *somebody*. It does not tell you with whom.** Unauthenticated DH is trivially man-in-the-middled: Eve runs DH with Alice and separately with Bob, and relays. **DH must always be authenticated** — by a signature over the exchange (TLS), a certificate, or a pre-shared long-term key (Signal). This is the single most important sentence about DH and it is the one people skip.
2. **Small-subgroup and parameter validation.** If an attacker sends `A = 0`, `1`, or `p−1`, the shared secret is forced into a tiny set. If the group order has small factors, the attacker learns the secret modulo those factors and grinds the rest. Finite-field DH requires validating the peer's public value and using a safe prime or a named group; getting this wrong is the CVE-2016-0701 shape of bug. **This class of bug is why X25519 (§3.6) was designed to make every 32-byte string a valid public key.**
3. **Ephemeral, not static.** `DHE`/`ECDHE` generates a fresh key pair per session and throws it away, giving **forward secrecy**: recording the traffic and later stealing the server's long-term key does not decrypt it, because the long-term key only *signed* the exchange, it did not encrypt anything. Static DH and RSA key transport have no such property, which is why TLS 1.3 removed them (§4.2).

**Logjam** (Adrian et al., CCS 2015) is the teaching attack. The discrete log problem in a *fixed* prime field has a precomputation structure: the number field sieve's expensive phase depends only on *p*, not on the specific exchange. Precompute once for a common 512-bit prime and you break any exchange using it in minutes. Because export-grade "DHE_EXPORT" cipher suites used a handful of hardcoded 512-bit primes, and because a downgrade flaw let an attacker force them, this was live against 8% of the Alexa top million. The paper's more consequential observation was that a **1024-bit** precomputation was plausibly within a nation-state's budget, and a small number of 1024-bit primes were hardcoded into a huge fraction of the internet's servers. The result was the industry-wide move to ≥2048-bit groups, named groups only (RFC 7919), and ultimately to elliptic curves.

### 3.3 RSA, and why textbook RSA is broken

RSA (Rivest, Shamir, Adleman, 1977) is the first published public-key encryption and signature scheme, and it is worth understanding both because it is still deployed and because its history is the best available catalogue of how a correct primitive becomes an insecure system.

```
Keygen:   pick primes p, q;  n = p·q;  φ(n) = (p−1)(q−1)
          pick e coprime to φ(n)   (universally 65537)
          d = e^(-1) mod φ(n)
          public (n, e);  private (n, d)
Encrypt:  c = m^e mod n
Decrypt:  m = c^d mod n            because m^(ed) ≡ m (mod n)
Sign:     s = m^d mod n
Verify:   m = s^e mod n
```

The correctness is Euler's theorem. The security assumption is that recovering *d* from *(n, e)* requires factoring *n*.

**Textbook RSA — the raw operation above, applied to a message — is broken**, in several independent ways, and it is important that these are not implementation bugs but properties of the mathematics:

- **It is deterministic.** The same message always encrypts to the same ciphertext. So an attacker with the public key can encrypt candidate messages and compare — which totally breaks RSA for any small message space. Encrypting a credit-card number, a vote, a "yes"/"no", a 6-digit code: all recoverable by exhaustive re-encryption. This alone disqualifies it.
- **It is malleable and homomorphic.** `(m₁^e)·(m₂^e) = (m₁m₂)^e mod n`. Multiply a ciphertext by `2^e` and you have doubled the plaintext, without the key. For signatures the same identity gives an existential forgery: from signatures on m₁ and m₂ you get a valid signature on m₁·m₂ for free.
- **Small messages do not wrap.** If *m* is small and *e* = 3, then `m³ < n`, so `c = m³` over the integers and the plaintext is an **integer cube root** — computable in microseconds with no key at all. This is not a corner case; it is what happens when you RSA-encrypt a short session key with a small exponent and no padding.
- **Håstad's broadcast attack.** Send the *same* message to *e* recipients with different moduli and *e*=3, and the CRT plus a cube root recovers it.
- **Common modulus, common factor, and related-message attacks** each break further variants.

So RSA is *never* used raw. **The padding scheme is not an optional wrapper; it is a load-bearing part of the cryptosystem.** This is a genuinely important idea and it generalises: a primitive's security theorem is a statement about a specific input distribution, and the padding is what forces your inputs into that distribution.

### 3.4 PKCS#1 v1.5, Bleichenbacher, and the twenty-eight-year tail

**PKCS#1 v1.5** (RSA Labs, 1993) is the original padding: `0x00 || 0x02 || (≥8 random nonzero bytes) || 0x00 || message` for encryption, and a similar deterministic structure with a hash and an algorithm identifier for signatures. It fixed the determinism and the small-message problems, and it was standardised into everything.

**Bleichenbacher (CRYPTO 1998)** broke it, with an attack whose structure should be familiar from §2.6. If a server, on receiving a malformed ciphertext, reveals **one bit** — "the decryption did not start with `00 02`" — then that server is an oracle. The attacker takes a target ciphertext, multiplies it by chosen values (using RSA's malleability, which now works *for* the attacker), submits the results, and each "conforming" answer narrows the interval containing the plaintext. Roughly a million queries in the original; modern refinements need far fewer. It is called the "million message attack" and it recovers the plaintext — typically a TLS pre-master secret — without the key.

What makes it the definitive cautionary tale is the **twenty-eight-year tail**:

| | Year | What happened |
|---|---|---|
| Bleichenbacher | 1998 | Original attack; TLS adds countermeasures (on failure, proceed with a random pre-master secret so the error is invisible) |
| Klíma–Pokorný–Rosa | 2003 | Bypasses the countermeasures using a *version-number* oracle |
| **DROWN** | 2016 | An SSLv2 server sharing an RSA key acts as a Bleichenbacher oracle against the modern TLS server. 33% of HTTPS servers vulnerable |
| **ROBOT** (Böck, Somorovsky, Young) | 2017 | "Return Of Bleichenbacher's Oracle Threat". Found the *same 1998 attack* still working against F5, Citrix, Radware, Cisco ACE, and Facebook's and PayPal's front ends. Nineteen years later |
| **Marvin** (Nemec et al.) | 2023 | The timing-based variant, still present in OpenSSL, GnuTLS, NSS and others because the constant-time countermeasure is extremely hard to write |

This is the strongest empirical evidence in the document for §1.4. The attack was famous. Every implementer knew about it. The countermeasure was specified in the standard. And it kept working, for a quarter of a century, because implementing "behave identically on malformed input, including in timing, through several layers of protocol code" is a thing humans cannot reliably do.

**The right padding schemes**, both from Bellare and Rogaway and both in PKCS#1 v2 (RFC 8017):

- **OAEP** (Optimal Asymmetric Encryption Padding) for encryption — a two-round Feistel over the message using a hash-based mask generation function, making the padded plaintext depend on randomness in a way that is provably CCA-secure in the random oracle model. **[Note: OAEP has its own implementation-level Manger attack (CRYPTO 2001) if the integer-to-octet-string conversion leaks; constant-time decoding is still required.]**
- **PSS** (Probabilistic Signature Scheme) for signatures — randomised, with a tight security proof, unlike v1.5 signatures which have no proof and a history of implementation forgeries (**BERserk**, and Bleichenbacher's own 2006 low-exponent signature forgery, which exploited implementations that did not check the padding was *exactly* right and let an attacker construct a "signature" that was just a cube root of a suitably-structured integer — **breaking RSA signature verification with no private key and no factoring, using only arithmetic**).

**Why RSA is fading**, and this is a real trend rather than an aesthetic preference:

1. **Key sizes are unwieldy.** 3072-bit RSA is needed for a 128-bit security level; ECC needs 256 bits (§3.5). That is a 12× difference in every certificate, handshake and stored key.
2. **Operations are slow and asymmetric in cost.** RSA-3072 signing is on the order of 100× slower than Ed25519 signing. (RSA *verification* with e=65537 is genuinely fast — often faster than ECDSA verification — which is the one place RSA still wins and the reason it survives in code-signing and in certificate chains.)
3. **Key generation is slow and dangerous.** Generating an RSA key requires finding two large random primes; on a device with weak entropy, two devices can generate moduli sharing a prime — and then `gcd(n₁, n₂)` factors both. This is exactly the 2012 "Mining Your Ps and Qs" result from §1.6 and the 2017 **ROCA** vulnerability (CVE-2017-15361), where Infineon's key generation library produced primes of a special form, letting attackers factor 1024- and 2048-bit RSA keys from the public key alone — affecting millions of smartcards, TPMs and Estonian national ID cards. **Elliptic curve key generation is "pick 32 random bytes", which cannot fail this way.**
4. **The parameter surface is enormous.** Modulus size, exponent choice, padding scheme, prime generation, CRT-based decryption (fast, but a single computational fault during CRT recombination **factors the modulus** — the Boneh–DeMillo–Lipton fault attack, which is why RSA implementations verify their own signatures before releasing them). Every one of those is a decision, and most have a corresponding CVE.
5. **It is not post-quantum, and neither is ECC** — but ECC's smaller keys make the hybrid transition cheaper (§5.4).

RSA is not broken. RSA-2048 with OAEP/PSS, correctly implemented, is fine today. But **nothing new should be built on it**, and the current answer for a new system is Ed25519 for signatures and X25519 for key agreement, moving to hybrid post-quantum for key agreement now (§5).

### 3.5 Elliptic curves

#### The group law, intuitively

An elliptic curve over a field is the set of points satisfying (in short Weierstrass form)

```
y² = x³ + ax + b
```

plus a **point at infinity** *O*. Over the reals this is a smooth cubic; the picture in every textbook. The content is that you can define an **addition** on the points, and it forms an abelian group.

The geometric rule, which is the intuition worth carrying:

- **P + Q**: draw the line through P and Q. A cubic meets a line in exactly three points, so it hits a third point R'. **Reflect R' across the x-axis** to get R = P + Q.
- **P + P** (doubling): the "line through P and P" is the **tangent** at P. Take its third intersection, reflect.
- **P + O = P**: *O* is the identity, the point "infinitely far up the y-axis".
- **P + (−P) = O**: the line through P and its reflection is vertical and meets the curve nowhere else — that "nowhere else" is *O*, which is exactly why the point at infinity has to exist.

The reflection step looks arbitrary and is not: the natural statement is that **any three collinear points on the curve sum to O**, and reflection is what turns "P + Q + R' = O" into "P + Q = −R'". Associativity is not obvious from the picture and is a genuine theorem.

For cryptography we work not over the reals but over a **finite field** — Z_p for a large prime *p*, or GF(2^m). The picture disappears (a scatter of points in a grid, no curve) but the algebra is unchanged: the same chord-and-tangent formulas, with all arithmetic mod *p*. That is the essential mental move: **the geometry supplies the definition; the finite field supplies the security.**

Scalar multiplication is repeated addition, `[k]P = P + P + ... + P` (*k* times), computed by double-and-add in O(log k) group operations. The **elliptic curve discrete logarithm problem (ECDLP)** is: given *P* and *[k]P*, find *k*.

#### Why the key sizes are so much smaller

Finite-field discrete log and factoring both fall to **index calculus** / the number field sieve, which run in *sub-exponential* time — roughly `exp((1.92 + o(1))·(ln n)^(1/3)·(ln ln n)^(2/3))`. That sub-exponential complexity is why RSA and finite-field DH need thousands of bits.

For a well-chosen elliptic curve **no index calculus algorithm is known**. The best generic attack is Pollard's rho, at **O(√n)** — fully exponential in the key size. So a 256-bit curve gives ~2^128 work, and to double the security you double the key size, which is the behaviour you would naively expect and which factoring-based systems do not have.

**The comparison table.** These are the standard equivalences; the specific numbers below are as given by **NIST SP 800-57 Part 1 Rev. 5 (May 2020)**, which remains the reference document as of September 2026:

| Security strength | Symmetric | RSA / finite-field DH modulus | Elliptic curve | Status per SP 800-57r5 |
|---|---|---|---|---|
| 80 bits | (2TDEA) | 1024 | 160–223 | Disallowed |
| 112 bits | 3TDEA | 2048 | 224–255 | Legacy use only; **deprecated after 2030** |
| **128 bits** | **AES-128** | **3072** | **256–383** | **Acceptable** |
| 192 bits | AES-192 | 7680 | 384–511 | Acceptable |
| 256 bits | AES-256 | 15360 | 512+ | Acceptable |

The 15360-bit RSA row is the argument in one line: nobody is going to deploy a 15360-bit RSA key (keygen takes minutes, a signature takes tens of milliseconds), whereas a 512-bit curve is unremarkable.

**NIST's stated timeline** (SP 800-57r5 and the transition guidance in SP 800-131A Rev. 2): 112-bit security — RSA-2048, P-224 — is deprecated after **2030** and disallowed after that, so **128-bit security is the floor for anything being designed now**. The post-quantum overlay on this schedule is NIST IR 8547 (initial public draft November 2024), which proposes deprecating RSA and ECC at all sizes after **2030** and disallowing them after **2035**.

#### The curves people actually use

| Curve | Origin | Notes |
|---|---|---|
| **P-256 / secp256r1 / prime256v1** | NIST, FIPS 186 | Ubiquitous — TLS certificates, WebAuthn, most hardware. Its parameters are generated from an unexplained seed, which is the root of persistent (unproven) suspicion after Dual_EC_DRBG. Short-Weierstrass form, so implementations need explicit special-case handling and are easy to get non-constant-time |
| **P-384, P-521** | NIST | Higher security levels; P-384 is the CNSA / high-assurance choice |
| **secp256k1** | SECG, "Koblitz" | Bitcoin and Ethereum. Chosen for efficient endomorphism-based speedups; no NIST provenance question |
| **Curve25519 / X25519** | Bernstein, 2005 | Montgomery form. Key agreement. §3.6 |
| **Ed25519** | Bernstein et al., 2011 | Twisted Edwards form, birationally equivalent to Curve25519. Signatures. §3.8 |
| **Curve448 / Ed448** | RFC 7748 / 8032 | ~224-bit security, the higher-margin option |

#### The ways elliptic curve implementations go wrong

Curves are a smaller footgun surface than RSA but not an empty one:

- **Invalid-curve attacks.** If you accept a peer's point without checking it is on your curve, the attacker sends a point on a *different* curve with smooth group order, and your scalar multiplication happily computes in that weak group, leaking your private key modulo small factors. **Point validation is mandatory** — and this is a real, exploited bug class (Jager, Schwenk, Somorovsky, CCS 2015, against several TLS libraries and JCE providers).
- **Small-subgroup attacks** on curves with a cofactor > 1.
- **Twist attacks** — if the curve's quadratic twist has smooth order, an x-coordinate-only implementation that skips validation leaks the key.
- **Non-constant-time scalar multiplication.** A naive double-and-add branches on the bits of the secret scalar; the branch is observable (§6.4). The Montgomery ladder does a fixed sequence of operations regardless.
- **The point at infinity and the special cases** in the Weierstrass addition formulas (P + P vs P + Q vs P + (−P)) are exactly the branches that leak, which is why complete formulas and alternative curve forms exist.

Every one of these is a reason for the design in the next section.

### 3.6 Curve25519, X25519, and design for misuse resistance

**Curve25519** (Bernstein, PKC 2006) is a Montgomery curve

```
y² = x³ + 486662x² + x     over  GF(2^255 − 19)
```

**X25519** is the Diffie-Hellman function on it (RFC 7748, January 2016): 32-byte private keys, 32-byte public keys, one function `X25519(scalar, u_coordinate) -> 32 bytes`.

What makes it important is not that it is faster (it is) but that **almost every foot-gun listed in §3.5 was designed out of it**. The design decisions, and what each removes:

| Decision | What it eliminates |
|---|---|
| **The prime is 2^255 − 19**, a pseudo-Mersenne prime | Fast, simple, constant-time modular reduction with no data-dependent branches — the reduction is a multiply-by-19 and an add, not a conditional subtract loop |
| **Montgomery ladder, x-coordinate only** | The scalar multiplication performs the *same operations in the same order* for every scalar. Constant-time by construction, not by discipline. Also halves the public key size |
| **Every 32-byte string is a valid public key** | **Invalid-curve attacks cannot be expressed.** There is no validation step to forget, because there is nothing to reject |
| **The curve is twist-secure** (the quadratic twist also has near-prime order) | Twist attacks are eliminated *mathematically*, which is why the previous row is safe |
| **Scalar clamping**: clear the low 3 bits, clear bit 255, set bit 254 | Clearing the low bits makes the scalar a multiple of the cofactor 8, killing small-subgroup attacks. Setting bit 254 fixes the scalar's bit length, so the ladder's iteration count does not leak the key's magnitude |
| **Parameters have a stated, reproducible derivation** ("the smallest A ≥ 2 satisfying the security criteria") | The Dual_EC-shaped question of "where did these constants come from" has an answer anyone can check |
| **No point compression/decompression, no cofactor decisions in the API** | Whole categories of implementation choice, and therefore of implementation bug, do not exist |

The generalisable lesson, and it is the most important idea in §3:

> **A primitive that cannot be misused is worth more than a faster primitive that can.** X25519's API has one function and no options. There is no "which curve", no "validate the point?", no "which point format", no "handle the cofactor". Compare the ECDH surface in a general library, where each of those is a call the caller can get wrong.

This is the same instinct as AEAD replacing "encrypt, then remember to MAC" (§2.8), deterministic nonces replacing "use good randomness" (§1.6), and it is the design philosophy behind libsodium (§6.4).

X25519 is the default key agreement in TLS 1.3, Signal, WireGuard, SSH, and age. It is the correct answer for new work — now in hybrid with ML-KEM (§5.4).

### 3.7 Digital signatures, and ECDSA's lethal nonce requirement

A signature scheme is three algorithms — `KeyGen`, `Sign(sk, m)`, `Verify(pk, m, σ)` — providing authenticity, integrity, and (unlike a MAC) **non-repudiation**, because only the holder of *sk* could have produced σ and anyone with *pk* can check it.

The security goal is **existential unforgeability under chosen-message attack (EUF-CMA)**: an adversary who can obtain signatures on messages of their choice still cannot produce a valid signature on any *new* message. Note how strong that is — it forbids forging a signature on nonsense, not just on meaningful messages.

**ECDSA** (ANSI X9.62, 1998; FIPS 186) is the elliptic-curve version of DSA, and its signing equation was reproduced in §1.6:

```
k ← random, secret, per-signature
R = [k]G ;  r = x(R) mod n
s = k^(-1)(z + r·d) mod n        where z = leftmost bits of H(m)
```

The nonce requirement, restated because it is the whole point of this section:

> ***k* must be uniformly random, kept secret, and never repeated. Any failure — repetition, partial predictability, or a few bits of bias — leaks the private key.**

§1.6 covered full reuse (Sony) and the partial-bias case (the Hidden Number Problem, Minerva, TPM-FAIL, LadderLeak, and the Android/Bitcoin story). What deserves stating here is *why the design is like this*: **the nonce is multiplied into the same equation as the private key, so information about one is information about the other.** It is not a bolted-on weakness. It is the algebra of the scheme.

Two further ECDSA sharp edges worth knowing:

- **Malleability.** If `(r, s)` is valid then so is `(r, n − s)`. Any system that treats a signature as a unique identifier — Bitcoin did, and it caused the transaction-malleability incidents culminating in Mt. Gox's 2014 claims — must canonicalise to low-*s*. BIP-62 and libsecp256k1 enforce this.
- **The verification equation involves an inversion mod n**, so verification is slower than Ed25519's and there are more places for an implementation to differ.

**RFC 6979** (Pornin, August 2013) is the standard mitigation: derive *k* deterministically as `HMAC_DRBG(sk, H(m))`. Same signatures for the same message, no RNG in the signing path, and a bad RNG can no longer produce a repeated nonce. Everything that still uses ECDSA should use it — Bitcoin's libsecp256k1 does, and so should you. (A refinement, *hedged* signing, mixes in some fresh randomness as well, so that a fault-injection attacker cannot force a repeat by replaying the same message. This is what modern libraries do.)

### 3.8 EdDSA and Ed25519 — the deterministic fix

**EdDSA** (Bernstein, Duif, Lange, Schwabe, Yang, 2011; RFC 8032, January 2017) is a Schnorr-family signature scheme on twisted Edwards curves. **Ed25519** is the instantiation on edwards25519, which is birationally equivalent to Curve25519.

```
Key:      sk = 32 random bytes;  h = SHA-512(sk);  a = clamp(h[0..31]);  prefix = h[32..63]
          pk = [a]B                                  (32 bytes, compressed)
Sign(m):  r = SHA-512(prefix || m)  mod L            ← DETERMINISTIC, no RNG
          R = [r]B
          k = SHA-512(R || pk || m) mod L
          S = (r + k·a) mod L
          signature = R || S                          (64 bytes)
Verify:   [S]B  ==  R + [k]pk
```

The differences from ECDSA are all deliberate and all are fixes:

| Property | Why it matters |
|---|---|
| **The nonce is deterministic**, `SHA-512(prefix ‖ m)`, where `prefix` is a secret half of the key hash | **The entire class of nonce failures from §1.6 and §3.7 is structurally impossible.** No RNG is involved in signing. Sony's bug cannot be written |
| **The whole public key and R are hashed into the challenge** | Prevents key-substitution and related-key attacks that ECDSA needed care to avoid |
| **Complete addition formulas** on the twisted Edwards form — one formula works for all point pairs including doublings and the identity | **No special cases means no branches means constant-time by construction.** This is the deep reason Edwards curves were adopted |
| **No modular inversion in signing or verification** | Faster, and one fewer variable-time operation to get wrong |
| **Small keys and signatures**: 32-byte public key, 64-byte signature | Compare RSA-3072's 384-byte signature |
| **Fast batch verification** | Verify *n* signatures for well under *n* times the cost — meaningful for blockchains and CT log auditors |
| **Cofactor and clamping handled inside the scheme** | Nothing for the caller to decide |

Performance, order of magnitude on a modern x86 core: Ed25519 signs in roughly 20–25 µs and verifies in 50–70 µs, which is on the order of tens of thousands of signatures per second per core — roughly 50–100× faster to sign than RSA-3072 and several times faster than P-256 ECDSA in most libraries. *(Figures are order-of-magnitude; measure on your hardware.)*

**The one wrinkle worth knowing about**, because it caused a standardisation mess: Ed25519 verification has historically differed between implementations on edge cases — whether to reject non-canonical encodings, whether to apply the cofactor-8 check, whether a signature valid under one library is valid under another. Chalkias, Garillot and Nikolaenko ("Taming the many EdDSAs", 2020) catalogued the divergences, and **FIPS 186-5 (February 2023)** — which approved EdDSA for US federal use for the first time — pins down a specific set of checks. If you need cross-implementation agreement on validity (consensus systems especially), use a library that implements a specified verification rule and say which one. **[The precise set of checks required for strict cross-library agreement is genuinely subtle; treat any summary, including this one, as a pointer to the paper rather than a specification.]**

**Which signature scheme, September 2026:**

| Situation | Use |
|---|---|
| New system, you control both ends | **Ed25519** |
| Higher security margin required | Ed448, or P-384 if a NIST curve is mandated |
| FIPS-validated module required | ECDSA on P-256/P-384, or ML-DSA (§5) — Ed25519 is approved by FIPS 186-5 but module availability lags |
| Interop with an existing PKI / WebPKI certificates | ECDSA P-256 (Ed25519 is still not broadly accepted by CAs and browsers as of this date) |
| Verification-heavy, signing-rare, legacy | RSA with PSS is defensible; verification is cheap |
| Long-term signatures that must survive quantum computers | SLH-DSA or ML-DSA (§5) |

### 3.9 Key sizes, with source and date

Everything in this table is from **NIST SP 800-57 Part 1 Revision 5, May 2020**, cross-checked against SP 800-131A Rev. 2 (March 2019) for the transition dates, and current as of **September 2026**. The European equivalents (BSI TR-02102-1, ANSSI) are broadly consistent but stricter in places — BSI has recommended 3000-bit RSA and 250-bit curves as a minimum for several years, and ANSSI has long recommended 3072-bit RSA.

| Purpose | Minimum for new systems (128-bit security) | Notes |
|---|---|---|
| Symmetric | **AES-128** | AES-256 for anything with a long confidentiality lifetime — see Grover, §5.1 |
| Hash (for signatures) | SHA-256 | SHA-384 at the 192-bit level |
| RSA | **3072** | 2048 is *legacy use only* and deprecated after 2030 |
| Finite-field DH | **3072** (group order ≥ 256) | Use named groups (RFC 7919); do not generate your own |
| Elliptic curve | **256** (P-256, Curve25519) | P-384 for 192-bit security |
| Post-quantum KEM | ML-KEM-768 | §5 |
| Post-quantum signature | ML-DSA-65 | §5 |

**The rule that outlives the table:** match the security levels of every component. A 4096-bit RSA key protecting an AES-128 session is an unbalanced design that costs performance and buys nothing; a P-256 certificate signed with SHA-1 is a chain whose strength is SHA-1's.

---

## 4. Protocols — how the primitives compose

### 4.1 The composition problem

Every primitive in §2 and §3 is, as far as anyone knows, secure. Essentially every real-world break is in the **composition**: the way primitives are wired together, the state machine around them, the parsing of the messages, and the trust decisions at the edges.

A protocol has to answer questions no primitive answers:

- **Who am I talking to?** (Authentication — DH does not tell you, §3.2.)
- **Is this message fresh, or a replay of one from last week?**
- **Is this the *n*-th message, and did I miss messages 3 through 7?** (Ordering and deletion detection.)
- **What happens when my long-term key is stolen tomorrow?** (Forward secrecy.)
- **What happens when it is stolen today and I do not notice?** (Post-compromise security.)
- **Which algorithms are we using, and can an attacker force us to a weaker set?** (Negotiation, downgrade protection.)
- **What does the state machine do on an unexpected message?**

That last one is not a footnote. **The state machine is a top-tier bug source.** Beurdouche et al.'s "A Messy State of the Union" (IEEE S&P 2015) fuzzed TLS implementations' state machines and found that several would accept protocol messages out of order in ways that skipped authentication entirely — including Apple's `goto fail` (CVE-2014-1266, a duplicated `goto` line that made signature verification unconditionally succeed) and GnuTLS's certificate-verification bug in the same season. Neither was a cryptographic weakness; both let anyone impersonate any server.

### 4.2 TLS 1.3

TLS 1.3 (RFC 8446, August 2018) is the most valuable protocol to study because it is a deliberate, aggressive simplification made *in response to* twenty years of the attacks in §2 and §3. The handshake message flow, 0-RTT, ALPN, ECH and the record layer are `networking-and-internet.md`'s material; what belongs here is **what was removed and why**, and **the key schedule**.

#### What TLS 1.3 deleted, and which attack each deletion kills

| Removed | Attack it enables |
|---|---|
| RSA key transport (static RSA key exchange) | Bleichenbacher/ROBOT (§3.4); and it has **no forward secrecy** — one stolen server key decrypts every recorded session ever |
| Static (non-ephemeral) DH | No forward secrecy |
| CBC mode, and MAC-then-Encrypt entirely | Padding oracles: Lucky 13, POODLE, Zombie POODLE (§2.6) |
| RC4 | Keystream biases (§2.10) |
| 3DES and all 64-bit-block ciphers | Sweet32 (§2.1) |
| Custom/arbitrary DH groups | Logjam (§3.2) |
| Compression | CRIME/BREACH — compressing attacker-influenced data alongside a secret leaks the secret through the length |
| Renegotiation | The 2009 renegotiation-injection flaw (CVE-2009-3555) |
| MD5 and SHA-1 signatures | Collisions |
| A per-suite choice of key exchange and authentication | Combinatorial explosion of negotiable states, and downgrade surface |

The cipher suite change is the clearest expression of the philosophy. A TLS 1.2 suite named four things at once — `TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256` = key exchange, authentication, cipher, MAC/PRF hash — and there were hundreds of them, most bad. **TLS 1.3 suites name only the AEAD and the hash**, and there are exactly five:

```
TLS_AES_128_GCM_SHA256        (mandatory to implement)
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256
TLS_AES_128_CCM_SHA256
TLS_AES_128_CCM_8_SHA256      (constrained/IoT; 64-bit tag — avoid)
```

Key exchange and authentication are negotiated separately, via the `supported_groups` and `signature_algorithms` extensions. **Every option in that list is an AEAD.** There is no way to negotiate an unauthenticated cipher, a CBC mode, or a broken hash, because those options do not exist in the protocol. This is §1.6's pattern at protocol scale: rather than trusting operators to configure TLS correctly — which twenty years demonstrated they cannot — the bad configurations were made unrepresentable.

#### The key schedule

TLS 1.3's key schedule is one long HKDF chain, and it is the best real-world example of §2.11's principles. Every secret is derived with a labelled `HKDF-Expand-Label`, and crucially most derivations mix in a **transcript hash** of every handshake message so far.

```
             0
             |
             v
  PSK ->  HKDF-Extract  =  Early Secret
             |
             +-> Derive-Secret(., "ext binder"|"res binder", "")
             +-> Derive-Secret(., "c e traffic", ClientHello)
             |
        Derive-Secret(., "derived", "")
             |
             v
(EC)DHE -> HKDF-Extract  =  Handshake Secret
             |
             +-> Derive-Secret(., "c hs traffic", ClientHello..ServerHello)
             +-> Derive-Secret(., "s hs traffic", ClientHello..ServerHello)
             |
        Derive-Secret(., "derived", "")
             |
             v
     0 -> HKDF-Extract  =  Master Secret
             |
             +-> Derive-Secret(., "c ap traffic", ClientHello..server Finished)
             +-> Derive-Secret(., "s ap traffic", ClientHello..server Finished)
             +-> Derive-Secret(., "exp master",   ClientHello..server Finished)
             +-> Derive-Secret(., "res master",   ClientHello..client Finished)
```

Five properties fall out of that diagram, and they are the reason it is worth reading:

1. **Layered extraction.** Each `HKDF-Extract` takes the previous stage's output as salt and new keying material as input. A PSK and a fresh DH exchange both contribute; **either one being strong is enough**, so a compromised PSK does not sink a session with fresh (EC)DHE and vice versa.
2. **Transcript binding.** `Derive-Secret` includes a hash of the handshake so far, so **the keys depend on every byte both parties saw**. If an attacker modified any handshake message — downgrading the group, stripping an extension — the two sides derive different keys, the `Finished` MACs disagree, and the handshake fails. **Downgrade protection is not a separate mechanism; it is a consequence of the key derivation.** (TLS 1.3 additionally plants a sentinel value in the ServerHello random to detect version downgrade by a 1.2-speaking middlebox.)
3. **Directional keys.** `c hs traffic` and `s hs traffic`, `c ap traffic` and `s ap traffic` — client and server never share a write key. This is exactly §2.7's "two senders, one key" hazard, designed out.
4. **Stage separation.** Handshake traffic keys and application traffic keys are different secrets; compromise of one does not give the other.
5. **Labels everywhere.** Every derivation carries a distinct string. Two secrets in this schedule can never collide by construction, which is what §2.11 means by domain separation.

Nonce construction is worth one line because it is a §2.7 lesson made concrete: TLS 1.3 does **not** transmit a per-record nonce. Each side derives a static `write_iv` and XORs in the 64-bit **record sequence number**, so the nonce is unique by counting rather than by randomness, and the key is rotated (`KeyUpdate`) long before the counter can wrap. There is no opportunity for a nonce generator to be buggy, because there is no nonce generator.

Rekeying: `KeyUpdate` derives the next traffic secret as `HKDF-Expand-Label(secret, "traffic upd", "", Hash.length)` — a one-way ratchet, so an attacker who compromises the current key cannot compute the previous one. That is a small version of the next section.

### 4.3 Signal: the double ratchet, forward secrecy, and post-compromise security

Signal's protocol (Marlinspike and Perrin; the Double Ratchet specification, 2016) is the strongest deployed answer to "what if the endpoint is compromised", and it is now the substrate for WhatsApp, Signal, Google Messages' RCS end-to-end encryption, Facebook Messenger's secret conversations, and Matrix's Olm/Megolm.

**The two properties, precisely, because they are frequently confused:**

- **Forward secrecy (FS)**: compromise of current keys does **not** expose *past* messages. Achieved by deleting old keys and deriving new ones one-way.
- **Post-compromise security (PCS), a.k.a. future secrecy or self-healing**: compromise of current keys does not expose *future* messages, **provided the attacker is passive after the compromise and the parties keep exchanging messages**. Achieved by injecting *new* entropy the attacker did not see.

FS is standard (TLS 1.3 has it). **PCS is the unusual one**, and it is a genuinely different security goal: it says the protocol *recovers* from a total key compromise. Nothing else in mainstream deployment does this.

**X3DH** (Extended Triple Diffie-Hellman) establishes the initial shared secret asynchronously — Bob may be offline, so he pre-publishes an identity key, a signed prekey, and a batch of one-time prekeys to the server. Alice fetches a bundle and computes:

```
DH1 = DH(IK_A, SPK_B)     ← Alice's identity  × Bob's signed prekey
DH2 = DH(EK_A, IK_B)      ← Alice's ephemeral × Bob's identity
DH3 = DH(EK_A, SPK_B)     ← Alice's ephemeral × Bob's signed prekey
DH4 = DH(EK_A, OPK_B)     ← Alice's ephemeral × Bob's one-time prekey (if available)
SK  = KDF(DH1 || DH2 || DH3 || DH4)
```

The reason for four of them: DH1 and DH2 provide **mutual authentication** (each binds one party's long-term identity), DH3 provides **forward secrecy** (both ephemeral/medium-term), and DH4 provides **replay protection and stronger forward secrecy** for the very first message, because the one-time prekey is deleted after use. Omitting DH4 (the server ran out) degrades gracefully rather than failing.

**The double ratchet** then runs two ratchets simultaneously, which is exactly why it is called "double":

**The symmetric-key ratchet (the chain).** Each direction has a chain key. For every message: `message_key, next_chain_key = KDF(chain_key)`, then **delete the old chain key and the message key after use**. This is a hash chain — one-way, so an attacker holding today's chain key cannot invert it to get yesterday's message keys. **Every single message gets its own key.** This provides fine-grained forward secrecy, and it also handles out-of-order and dropped messages: a receiver can advance the chain and cache the skipped message keys.

**The Diffie-Hellman ratchet (the root).** Each party attaches a **fresh ephemeral public key** to their messages. Whenever a party receives a new ratchet public key from the other side, it performs a DH with its own current ratchet private key and mixes the result into the **root key**:

```
root_key, new_chain_key = KDF(root_key, DH(my_ratchet_priv, their_ratchet_pub))
```

This is where PCS comes from. **New, uncompromised entropy enters the system on every round trip.** An attacker who steals the complete state at time *t* can decrypt from *t* forward only until the next DH ratchet step, at which point the shared secret depends on a private key generated after the compromise, which the passive attacker never saw. The conversation heals.

Two limits worth stating, because they are what the property actually promises:

- **PCS requires a round trip.** If Alice sends fifty messages with no reply, the DH ratchet does not advance and the compromise persists across all of them.
- **PCS assumes the attacker goes passive.** An attacker who retains code execution on the device simply reads the new keys too. PCS defends against key exfiltration, not against ongoing device compromise.

**What Signal does not solve** — and this is the honest part of the discussion, and it is where every real-world attack on end-to-end messaging actually lands:

- **Endpoint compromise.** The message is plaintext on the screen. Malware on either device reads everything, and no protocol can prevent this.
- **Identity verification.** The server hands you the other party's identity key. If the server lies, it is a man in the middle. The defence is **safety number / QR code verification out of band**, which approximately nobody does. Key Transparency (Signal shipped one, 2023) is the systemic fix: a verifiable append-only log of key bindings, so a server that serves different keys to different parties can be caught — the same idea as Certificate Transparency (§4.4), applied to messaging.
- **Metadata.** Who talks to whom, when, and how much is not hidden by message encryption. Signal's sealed sender and private contact discovery attack this, with partial success; traffic analysis remains the hard, largely unsolved part.
- **Group messaging** is genuinely harder — the pairwise double ratchet does not scale to large groups, which is why Signal uses a sender-keys construction and why the IETF standardised **MLS (Messaging Layer Security, RFC 9420, July 2023)** using a tree-based ratchet with O(log n) update cost.

### 4.4 The CA trust model, its real weaknesses, and Certificate Transparency

TLS gives you an authenticated channel to whoever holds the private key for the certificate. The remaining question — **is that the right party?** — is answered by the Web PKI, and it is the weakest link in internet security by a wide margin.

**The model:** your OS/browser ships a **root store** of ~100–150 trusted CA certificates. A CA signs an intermediate; the intermediate signs a server certificate binding a public key to a domain name; your client walks the chain to a trusted root and checks each signature, the validity dates, the name, and the revocation status.

**The structural problem, stated as sharply as it deserves:**

> **Any CA in the root store can issue a valid certificate for any domain in the world.** The trust model is a logical OR across every trusted CA, all of their intermediates, all of their delegated resellers, and every employee and system with issuance authority in each. The security of your bank's certificate is the security of the *weakest* CA your browser trusts, not the one your bank chose.

That is not a hypothetical failure mode; it is a list of incidents:

| Incident | Year | What happened |
|---|---|---|
| **Comodo** reseller breach | 2011 | Nine fraudulent certs including `mail.google.com`, `login.yahoo.com`, `addons.mozilla.org` |
| **DigiNotar** | 2011 | Full CA compromise; **531 fraudulent certificates**, including a wildcard `*.google.com` used in an active MITM against ~300,000 Iranian users. DigiNotar was removed from every root store and went bankrupt within two months |
| **TÜRKTRUST** | 2013 | Mis-issued intermediate CA certs; one used to MITM `*.google.com` |
| **ANSSI (France)** | 2013 | An intermediate used for MITM of Google domains on a private network |
| **CNNIC / MCS Holdings** | 2015 | Unconstrained intermediate used to MITM Google domains; CNNIC removed from Chrome and Firefox root stores |
| **Symantec** | 2015–2017 | Test certificates for `google.com` issued without authorisation, then an audit revealing >30,000 improperly issued certificates. Google forced a staged distrust; Symantec sold its CA business to DigiCert |
| **Let's Encrypt CAA rechecking bug** | 2020 | A code bug caused ~3 million certificates to be revoked |

The pattern: **compromise or error at any one of ~150 organisations is a compromise of the whole system.** Add that many CAs are subject to legal compulsion in their jurisdictions.

**Other real weaknesses:**

- **Revocation is broken.** CRLs are large and stale. OCSP is a real-time request that leaks the user's browsing to the CA and, critically, **fails open** — browsers historically treated an unreachable OCSP responder as "valid", because failing closed would take sites offline whenever a CA had an outage, which means an attacker who can block OCSP (and an attacker doing MITM certainly can) defeats it entirely. OCSP stapling fixes the privacy and latency problems but not the fail-open problem unless `Must-Staple` is set, which almost nobody sets. The practical answer became **short-lived certificates** — 90 days at Let's Encrypt, and the CA/Browser Forum has been ratcheting maximum lifetimes down (398 days, then 200, on a schedule toward ~47 days by 2029) — replacing revocation with expiry. **[The exact lifetime ratchet schedule adopted by the CA/Browser Forum should be re-checked; it was still being phased in as of this research date.]** Browsers also ship curated revocation sets (Chrome's CRLSets, Mozilla's CRLite) that cover the important revocations by pushing them to the client.
- **Domain validation is as strong as DNS, BGP and email.** A "DV" certificate is issued to whoever can prove control of the domain — usually by serving a file over HTTP or publishing a DNS record. An attacker who can hijack BGP for a few minutes can obtain a genuine certificate. Birge-Lee et al. demonstrated exactly this; the mitigation is **multi-perspective validation** (validating from several network vantage points), now mandated by the CA/Browser Forum and deployed by Let's Encrypt since 2020.
- **Name constraints are barely used.** An intermediate CA *can* be technically constrained to a set of domains. Most are not, so every intermediate is a full CA.
- **Certificate pinning failed as a solution.** HPKP (HTTP Public Key Pinning) let a site pin its keys, and it was **removed from Chrome in 2018** because it was a loaded gun: a site that lost its pinned keys bricked itself, and "RansomPKP" — an attacker pinning keys they control — was a real risk. Pinning survives only inside applications that control both ends.

**Certificate Transparency is the systemic fix.** Rather than trying to prevent mis-issuance, CT makes it **undeniable and detectable**.

- Every certificate is submitted to public, **append-only, cryptographically verifiable logs** built on **Merkle trees**. The log returns a **Signed Certificate Timestamp (SCT)**, a promise to include the certificate within a defined merge delay.
- Chrome (since April 2018) and Safari **require** certificates to carry SCTs from multiple independent logs, delivered in the certificate, via OCSP stapling, or in a TLS extension. No SCTs, no connection.
- The Merkle structure gives two efficient proofs: an **inclusion proof** that a specific certificate is in the log, and a **consistency proof** that a later log state is an append-only extension of an earlier one. Auditors and monitors check these; a log that forks or removes an entry is caught mathematically. (The Merkle tree mechanics themselves belong to `information-theory-coding.md`.)
- **Monitors** — Facebook's, Cloudflare's Nimbus, crt.sh, Censys — let any domain owner watch for certificates issued for their names.

The philosophical shift is worth naming because it recurs throughout modern security engineering: **CT does not add prevention, it adds detection and accountability.** Given that preventing 150 organisations from ever erring is impossible, the achievable goal is that every issuance is public and any mis-issuance is discoverable. It worked: the Symantec distrust was driven by CT data, and mis-issuance is now typically found in hours.

**DANE** (DNS-based Authentication of Named Entities, RFC 6698) is the alternative that did not happen for the Web — publish your certificate in DNSSEC-signed DNS and bypass CAs. Browsers never adopted it, partly because DNSSEC deployment is patchy and partly because it relocates trust to the DNS root and TLD operators rather than eliminating it. It has real traction in SMTP (MTA-STS and DANE for mail) but not in HTTPS.

### 4.5 Password authentication done properly

The primitive (§2.12) is the easy part. The system around it is where the failures are.

**The storage rules**, in order:

1. **Argon2id**, tuned to your hardware (§2.12). bcrypt and scrypt are acceptable; anything else — SHA-256, MD5, a homemade iteration loop, "salted SHA-1" — is a finding.
2. **A unique random salt per password**, ≥16 bytes, from a CSPRNG, stored alongside the hash. Modern password-hash libraries do this for you and encode the salt and parameters into the output string (the PHC string format, `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`); use that format so parameters can be upgraded per-user.
3. **Constant-time comparison** of the resulting hashes.
4. **Optionally a pepper**, held in a KMS/HSM or an env var outside the database.

**The protocol rules**, which matter more than most teams think:

- **Never log, never email, never store the plaintext.** "Here is your password" in a recovery email means it was recoverable, which means it was not hashed.
- **Do not leak account existence** through the login error, the registration error, the reset-request response, *or the response time*. A "user not found" path that skips the Argon2 computation returns in 1 ms while a real user's path takes 100 ms; that timing difference is a username enumeration oracle, and it is one of the most common findings in real assessments. The fix is to run the hash against a dummy hash on the not-found path.
- **Rate limit** per account and per source, with exponential backoff. This is what actually stops credential stuffing, not password complexity rules.
- **Check against breached-password corpora.** Have I Been Pwned's Pwned Passwords API uses **k-anonymity**: you send the first 5 hex characters of the SHA-1 of the candidate password, and receive every suffix with that prefix, checking locally. The server never learns the password or its full hash. It is a small, elegant privacy construction and worth studying on its own.
- **Modern composition guidance, from NIST SP 800-63B** (Rev. 3, and Rev. 4 published 2024–2025): require a **minimum length of 8 (15 recommended)**, allow at least 64 characters, allow all printable characters including spaces and Unicode, **do not impose composition rules** (one uppercase, one digit, one symbol), and **do not force periodic rotation** unless there is evidence of compromise. The rationale is behavioural and well supported: composition rules and forced rotation produce `Password1!` and then `Password2!`. Screen against known-breached lists instead. **[SP 800-63B Rev. 4's exact final wording should be re-checked against the published document; the substance of the guidance has been stable since Rev. 3 in 2017.]**
- **Password reset tokens are credentials.** ≥128 bits from a CSPRNG, single-use, short expiry, invalidated on use and on password change, and compared in constant time. A predictable reset token is a full account takeover and the hashing you did upstream is irrelevant.
- **Sessions**: ≥128-bit random session identifiers, regenerated on privilege change (session fixation), `HttpOnly; Secure; SameSite`, with server-side invalidation on logout.

**Second factors, ranked honestly:**

| Factor | Phishing-resistant? | Notes |
|---|---|---|
| SMS OTP | **No** | SIM swap, SS7 interception, and it is phishable in real time. Better than nothing; NIST restricted it in 800-63B |
| TOTP (RFC 6238) | **No** | A shared secret and a 30-second window; a phishing site simply relays the code. Still a large improvement over password-only |
| Push approval | No (fatigable) | "MFA fatigue" attacks — spam the prompt until the user taps accept — were the entry point for several 2022 breaches. Number matching helps |
| **WebAuthn / FIDO2 / passkeys** | **Yes** | The authenticator signs a challenge **bound to the origin**, so a phishing site at a different origin cannot obtain a usable assertion. This is the only widely deployed factor that structurally defeats phishing |

**Passkeys are the direction of travel, and the reason is architectural:** there is no shared secret. The server stores a public key. A server breach yields public keys, which are public. There is nothing to hash, nothing to salt, nothing to rotate, and nothing to phish. Every problem in this section exists because passwords are a secret both parties must know; the fix is to stop having one.

### 4.6 MACs versus signatures

Both produce a tag that detects tampering. Choosing wrongly is either a security bug or a 1000× performance bug.

| | MAC (HMAC, Poly1305, GMAC, KMAC) | Signature (Ed25519, ECDSA, RSA-PSS, ML-DSA) |
|---|---|---|
| Keys | One **shared** secret | Key pair; private signs, public verifies |
| Who can verify | Only holders of the secret — who can therefore also forge | **Anyone** with the public key |
| Non-repudiation | **No.** Either party could have made the tag | **Yes** |
| Speed | ~1–3 GB/s (HMAC-SHA256), ~10 GB/s (Poly1305, GMAC with PCLMULQDQ) | Ed25519: ~30k signs/s, ~15k verifies/s per core. **Three to four orders of magnitude slower per operation** |
| Tag size | 16–32 bytes | 64 bytes (Ed25519) to 384 (RSA-3072) to 2420+ (ML-DSA-44) |
| Key distribution | Must pre-share, confidentially, with each party | Publish the public key freely |
| Scaling to *n* parties | *n(n−1)/2* keys, and any holder can forge to any other | *n* key pairs |

**The decision rule, in one question: does a party who is not a key holder need to verify, or might either key holder later need to deny authorship?**

- **Yes → signature.** Software update verification (every user verifies, the vendor cannot disclaim), certificates, code signing, blockchain transactions, audit logs that must stand up externally, legal documents.
- **No → MAC.** Session integrity between two endpoints that already share a key (TLS records, Signal messages), API request authentication with a shared secret, cookie and token integrity where the same server issues and validates, database field integrity.

Common mistakes worth naming:

- **Using a signature where a MAC would do.** A server signing its own session cookies with RSA is paying ~1 ms per request for a property (third-party verifiability) it does not use. HMAC costs microseconds. This is a large fraction of JWT deployments (§4.7).
- **Using a MAC where a signature is required.** A shared HMAC key across a fleet of services means any compromised service can forge any message from any other, and no incident investigation can attribute anything.
- **Believing a MAC proves *who* sent it in a multi-party setting.** It proves *a key holder* sent it. With three services sharing a key, it proves nothing about which.
- **Signing a hash without domain separation.** If the same key signs both certificates and, say, timestamps, and the formats can overlap, a signature from one context is valid in the other. Prefix a context string before hashing.

One more, because it appears constantly in application code: **HMAC is not "hash the key concatenated with the message"**. `H(key ‖ msg)` is vulnerable to length extension on Merkle–Damgård hashes (SHA-256 included), letting an attacker append data and produce a valid tag without the key. HMAC's nested `H((K⊕opad) ‖ H((K⊕ipad) ‖ m))` structure exists precisely to prevent that. (The length-extension property itself is `information-theory-coding.md`'s material; the consequence is here.) With SHA-3 or BLAKE2/BLAKE3, `H(key ‖ msg)` is safe because those constructions are not length-extendable — but use the library's keyed mode rather than relying on that.

### 4.7 JWT and its footguns

JSON Web Tokens (RFC 7519) are the standard bearer-token format and, for the purposes of this document, a compact museum of composition errors. A JWT is `base64url(header).base64url(payload).base64url(signature)`, with the header naming the algorithm.

**Footgun 1: `alg: none`.** The spec defines an "unsecured JWT" with no signature. A library that honours the `alg` field from the token itself will accept `{"alg":"none"}` with an empty signature — **the attacker chooses the verification algorithm**. Multiple libraries shipped this (a well-publicised 2015 sweep found it across several ecosystems), and it recurs.

**Footgun 2: algorithm confusion, HS256 vs RS256.** The server holds an RSA public key to verify RS256 tokens. The attacker sends a token with `alg: HS256`, HMAC'd using **the RSA public key bytes as the HMAC secret**. A naive verifier dispatches on `alg`, sees HS256, retrieves "the key", and validates. **The public key is public**, so the attacker forges arbitrary tokens.

The root cause of both is one design error worth generalising:

> **The token tells the verifier how to verify the token.** Attacker-controlled data is being used to select the security policy.

The fix is to **pin the algorithm at the verifier**: decide out-of-band that this endpoint accepts exactly RS256 with exactly this key, and reject everything else before parsing further. Do not pass the token's `alg` to your verification function.

**Footgun 3: `kid` injection.** The `kid` (key ID) header selects which key to use. If it is interpolated into a filesystem path or a SQL query, you get path traversal (`kid: "../../dev/null"` with an empty key) or SQL injection into key selection.

**Footgun 4: `jku`/`x5u` — fetching the key from a URL in the token.** The header can name a URL to fetch the verification key from. If honoured without a strict allowlist, the attacker hosts their own key. This should never be enabled.

**Footgun 5: revocation.** A JWT is a **bearer token that is valid until it expires**, by design — that statelessness is the entire selling point. There is no logout, no "revoke this session", no "this user was just fired", short of maintaining a denylist — at which point you have server-side session state and have given up the reason you chose JWTs. Short expiry plus refresh tokens is the standard mitigation and it is a trade-off, not a solution.

**Footgun 6: claims that are not checked.** `exp` (expiry), `nbf` (not before), `iss` (issuer), `aud` (audience) are only enforced if you enforce them. Unchecked `aud` means a token minted for service A is accepted by service B. Unchecked `exp` means tokens are eternal. Several libraries did not validate `exp` by default.

**Footgun 7: putting secrets in the payload.** The payload is **base64, not encryption**. Anyone holding the token reads it. This surprises people with impressive regularity. (JWE exists for encrypted tokens and is much less used.)

**Footgun 8: weak HMAC secrets.** An HS256 token signed with a guessable secret is offline-brute-forceable — `hashcat` has a mode for it. If you use HS256, the secret must be ≥256 random bits, not a word from your config file.

**The honest summary:** for a first-party web application, a **random opaque session identifier in a `HttpOnly; Secure; SameSite` cookie, with server-side session state**, is simpler, revocable, leaks nothing, and has none of these failure modes. JWTs earn their keep for **cross-service, cross-domain authorisation where the verifier cannot reach the issuer's session store** — which is a real requirement, and much rarer than JWT adoption suggests. When you do use them, use a well-maintained library, pin the algorithm, validate every claim, and keep expiry short. **PASETO** exists as a deliberate redesign that removes the algorithm-agility footguns by versioning the whole protocol instead of negotiating per-token, and it is worth knowing about as an example of the §1.6 pattern applied to token formats.

---

## 5. Post-quantum cryptography, dated

**Everything in this section is stated as of September 2026.** This is the section that rots fastest. Section 5.6 gives the re-check trigger and the authoritative sources to re-check against.

### 5.1 Shor and Grover — precisely what each breaks, and by how much

The two quantum algorithms that matter to cryptography do **completely different amounts of damage**, and conflating them is the most common error in discussions of this topic.

#### Shor's algorithm (1994) — catastrophic, for asymmetric only

Shor's algorithm factors integers and computes discrete logarithms in **polynomial time** on a sufficiently large fault-tolerant quantum computer — roughly O((log N)²(log log N)(log log log N)) quantum operations plus polynomial classical post-processing. The mechanism is period-finding: factoring and discrete log both reduce to finding the period of a function, and the quantum Fourier transform finds periods efficiently.

**What Shor breaks, completely and permanently:**

| Broken | Why |
|---|---|
| **RSA**, all key sizes | Factoring becomes polynomial |
| **Finite-field Diffie-Hellman**, DSA, ElGamal | Discrete log becomes polynomial |
| **ECDH, ECDSA, EdDSA, X25519, Ed25519**, all curves | The elliptic-curve discrete log is also a hidden-subgroup problem; Shor applies |

Note the second column of the ECC row carefully: **elliptic curves are broken *harder* than RSA in the quantum setting.** The resource estimates put ECC-256 at fewer logical qubits and less circuit depth than RSA-2048 — Roetteler, Naehrig, Svore and Lauter (2017) estimated roughly 2330 logical qubits and ~1.26×10^11 Toffoli gates for a 256-bit curve, against Gidney and Ekerå's (2019) 20 million *noisy physical* qubits and 8 hours for RSA-2048. **Bigger keys do not help at all** — the algorithm is polynomial, so doubling the key size roughly doubles or quadruples the work rather than squaring the difficulty. There is no "just use RSA-16384" escape.

**How far away is it?** Nobody knows, and anyone giving you a confident date is selling something. What can be said with a straight face:

- Machines available in 2026 have on the order of hundreds to low thousands of *physical* qubits with error rates that require thousands of physical qubits per *logical* qubit. Estimates for RSA-2048 run to millions of physical qubits.
- The gap is roughly three to four orders of magnitude in qubit count, plus a coherence-time and error-correction problem that is the real barrier.
- Resource estimates have been **falling steadily** as error-correction schemes and circuit constructions improve. Gidney and Ekerå cut the RSA-2048 estimate by roughly an order of magnitude over previous work; a 2025 Gidney follow-up reduced it further, to under a million noisy qubits. **The trend of the estimates is the thing to watch, more than any single estimate.**
- Government migration deadlines (NIST IR 8547: quantum-vulnerable algorithms deprecated after 2030, disallowed after 2035; NSA's CNSA 2.0 timeline) are the operative planning dates regardless of when the machine arrives.

#### Grover's algorithm (1996) — a square root, and much less alarming

Grover's algorithm searches an unstructured space of size *N* in **O(√N)** — a quadratic speedup. Against a symmetric key of *κ* bits it reduces brute force from 2^κ to 2^(κ/2).

**The naive conclusion — "halve every symmetric key size, so AES-128 gives 64-bit security" — overstates the threat**, for reasons that are well established and worth knowing:

1. **Grover is inherently serial.** The speedup comes from ~√N sequential oracle iterations, and unlike classical brute force it **parallelises badly**: running *m* quantum machines gives only a √m improvement, so you cannot buy your way out of the wall-clock time. 2^64 sequential quantum operations on any plausible machine is centuries.
2. **Each oracle iteration is an entire AES circuit run coherently**, under full error correction. The constant factors are enormous — NIST's own call-for-proposals security categories were defined *in terms of* the quantum resources to attack AES-128 and AES-256, precisely because those constants matter.
3. **NIST's assessment (as expressed in the PQC security categories and in NIST IR 8105) is that AES-128 remains acceptable**, and that the practical response is to prefer 256-bit keys where the data has a long confidentiality lifetime rather than to treat 128-bit symmetric crypto as broken.

| Primitive | Classical security | Post-Grover | Verdict |
|---|---|---|---|
| AES-128 | 128 | 64 (nominal, with huge constants and no parallelism) | Acceptable; prefer 256 for long-lived data |
| AES-256 | 256 | 128 (nominal) | Fine |
| SHA-256 (preimage) | 256 | 128 | Fine |
| SHA-256 (collision) | 128 (birthday) | ~128 — Brassard–Høyer–Tapp gives 2^(n/3) but needs vast quantum memory, and is not competitive with classical parallel search | Fine |
| ChaCha20 (256-bit key) | 256 | 128 | Fine |
| Poly1305 / GMAC | 128-bit tag | Unaffected in the relevant sense | Fine |

**The one-line summary that is worth memorising:**

> **Shor kills all deployed public-key cryptography outright. Grover mildly inconveniences symmetric cryptography. Doubling symmetric key sizes handles Grover; nothing handles Shor except replacing the algorithm.**

### 5.2 The NIST standards

NIST ran an open competition from December 2016 (69 initial submissions) to selection in July 2022 and final standards in **August 2024**. The three published standards, verified against csrc.nist.gov (fetched September 2026):

| Standard | Name | Was | Type | Basis |
|---|---|---|---|---|
| **FIPS 203** | **ML-KEM** (Module-Lattice-Based Key-Encapsulation Mechanism) | CRYSTALS-**Kyber** | KEM | Module Learning With Errors |
| **FIPS 204** | **ML-DSA** (Module-Lattice-Based Digital Signature Algorithm) | CRYSTALS-**Dilithium** | Signature | Module-LWE / Module-SIS, Fiat–Shamir with aborts |
| **FIPS 205** | **SLH-DSA** (Stateless Hash-Based Digital Signature Algorithm) | **SPHINCS+** | Signature | Hash functions only |

All three were published in **final form on 13 August 2024**. The names changed on standardisation, and both names are in circulation — the standardised names are the ones to use in specifications, but library APIs and papers still say Kyber and Dilithium.

**ML-KEM (FIPS 203)** is a *key encapsulation mechanism*, not an encryption scheme and not a Diffie-Hellman. The interface is:

```
(pk, sk)        = KeyGen()
(ct, K)         = Encaps(pk)        ← generates a fresh shared secret K and its encapsulation
K               = Decaps(sk, ct)
```

Parameter sets and sizes (from FIPS 203):

| Set | NIST category | Public key | Ciphertext | Shared secret |
|---|---|---|---|---|
| ML-KEM-512 | 1 (≈AES-128) | 800 B | 768 B | 32 B |
| **ML-KEM-768** | **3 (≈AES-192)** | **1184 B** | **1088 B** | **32 B** |
| ML-KEM-1024 | 5 (≈AES-256) | 1568 B | 1568 B | 32 B |

**ML-KEM-768 is the deployed default**, chosen as the general-purpose recommendation by essentially everyone (and specifically the level used in the hybrid TLS group, §5.4). Compare the sizes to X25519's 32-byte public key: **a hybrid TLS handshake grows by roughly 1–2 KB in each direction.** That is the entire practical cost, and it is why the deployment story is about handshake size and packet fragmentation rather than CPU — ML-KEM operations are lattice arithmetic (NTT-based polynomial multiplication) and are genuinely *fast*, often faster than X25519.

**ML-DSA (FIPS 204)** signature sizes are the harder problem:

| Set | NIST category | Public key | Signature |
|---|---|---|---|
| ML-DSA-44 | 2 | 1312 B | 2420 B |
| **ML-DSA-65** | **3** | **1952 B** | **3309 B** |
| ML-DSA-87 | 5 | 2592 B | 4627 B |

Against Ed25519's 32-byte key and 64-byte signature, that is a 40–60× increase. A WebPKI certificate chain typically carries several signatures and several public keys, so **post-quantum certificates are the genuinely painful part of the migration** — far more so than key exchange. This is why key exchange has deployed first and authentication has not (§5.4).

**SLH-DSA (FIPS 205)** is the conservative backstop. It is built **only from hash functions** — no lattices, no number theory, no new hardness assumption beyond the security of the hash. That makes it the thing to reach for if lattice cryptanalysis ever advances unexpectedly. The costs are large: signatures from ~7,856 bytes (SLH-DSA-128s) to ~49,856 bytes (SLH-DSA-256f), and signing that is orders of magnitude slower than ML-DSA in the "small signature" variants. It is stateless, unlike the earlier hash-based schemes (XMSS, LMS — RFC 8391 and RFC 8554, both approved by NIST SP 800-208), which are **stateful** and carry a catastrophic operational hazard: reusing a one-time-signature state index breaks the scheme, and any system that can be restored from a backup can reuse an index. **Stateless is worth the signature size for almost everyone.** SLH-DSA's natural home is firmware and code signing, where signatures are rare, verification is what matters, and the trust root must last decades.

### 5.3 What came after, and what is still coming

| Item | Status as of September 2026 | Source |
|---|---|---|
| **HQC** (Hamming Quasi-Cyclic) | Selected in **March 2025** as a **backup KEM** to ML-KEM, chosen specifically because it is **code-based** rather than lattice-based, so a break of lattices would not take it with it. Draft standard expected around 2026 with final publication targeted for 2027 | NIST PQC project page |
| **FN-DSA** (FALCON) → **FIPS 206** | Still in **draft** as of this date; final publication expected late 2026 / early 2027. FALCON's appeal is much smaller signatures than ML-DSA (~666 B at category 1) but it uses floating-point Gaussian sampling, which is notoriously difficult to implement in constant time and is the reason it lagged the other three | NIST PQC project page; **[final publication date unverified]** |
| **Additional signatures ("onramp")** round | NIST's call for additional signature schemes (2022) has been running to find non-lattice signature diversity; a second-round list exists. **[The current round status and any 2026 selections are unverified.]** | — |
| **Classic McEliece** | Very large public keys (hundreds of KB), very small ciphertexts, extremely well-studied since 1978. Not selected by NIST but **standardised by ISO**, and favoured by some European guidance | — |
| **SIKE / SIDH** | **Broken.** Castryck and Decru's classical attack (July 2022) recovered the key in about an hour on one core, and it was a NIST round-4 candidate at the time. Worth remembering as evidence that PQC candidates are not all equally settled | Castryck–Decru, 2022 |

The SIKE break deserves its line in any curriculum. It was an isogeny-based scheme, well regarded, that had survived years of analysis, and it fell to a *classical* attack using 25-year-old mathematics that nobody had connected to it. **This is the strongest argument for hybrid deployment and for algorithm diversity**: the new assumptions are new, and confidence in them is a decade or two old rather than a half-century.

### 5.4 Hybrid key exchange, and what is actually deployed

**Hybrid** means running a classical and a post-quantum key exchange and combining both shared secrets through a KDF, so that **the result is secure if *either* component is secure**.

```
ss_classical = X25519(...)
ss_pq        = ML-KEM-768.Decaps(...)
key          = KDF(ss_classical || ss_pq || transcript)
```

The rationale is symmetrical distrust: ML-KEM is new and could have a cryptanalytic surprise (see SIKE), while X25519 is well understood but will fall to Shor. Combining them costs one extra operation and a kilobyte, and removes the need to bet on either.

**What is deployed, verified September 2026:**

- **X25519MLKEM768** is the hybrid group that won. It combines X25519 with ML-KEM-768. IANA has assigned it TLS supported-group codepoint **4588 (0x11EC)** — verified directly against the IANA TLS Parameters registry (fetched September 2026). The registry also shows the earlier experimental **X25519Kyber768Draft00** at **25497 (0x6399)**, now marked **OBSOLETE** and noted as a pre-standard version of Kyber, obsoleted by an RFC (the registry cites RFC 10024). The companion groups **SecP256r1MLKEM768 (4587)** and SecP384r1MLKEM1024 are also registered for deployments that must use NIST curves.
- **The migration path is visible in that registry**: Chrome and Cloudflare deployed `X25519Kyber768Draft00` from 2023, then switched to `X25519MLKEM768` once FIPS 203 was final — Chrome made the switch in **Chrome 131 (November 2024)**, and Firefox enabled X25519MLKEM768 by default around **Firefox 132–135 (late 2024 / early 2025)**. Cloudflare, AWS (s2n and KMS/ACM), OpenSSH (from 9.x, with `sntrup761x25519` first and `mlkem768x25519` subsequently), Signal (PQXDH, §5.5), and Apple's iMessage (PQ3) are all deployed.
- **Adoption numbers**: Cloudflare's own measurements showed post-quantum key agreement at roughly **2% of human TLS 1.3 traffic in early 2024**, rising sharply once Chrome enabled it by default. Cloudflare Radar publishes a live figure, and by 2025–2026 the share of PQ-protected traffic to Cloudflare had grown to a substantial fraction of connections. **[The precise current percentage is not verified here; check radar.cloudflare.com/adoption-and-usage for the live number.]**

**What is *not* deployed: post-quantum authentication.** Every deployment above protects the **key exchange** only; the certificate chain is still ECDSA or RSA. That is a deliberate and correct prioritisation, and the reasoning is the single most useful idea in this section:

> **Key exchange must be protected now; authentication can wait.** A recorded handshake can be broken later and its traffic decrypted retroactively (§5.5). A *signature* cannot be attacked retroactively — forging a signature after the fact does not let you impersonate anyone in a session that already happened. Authentication only needs to be quantum-safe by the time a quantum computer exists.

Combine that with the size numbers from §5.2 — ML-DSA-65 signatures at 3.3 KB versus Ed25519's 64 bytes, multiplied across a chain of two or three certificates plus SCTs plus OCSP — and the WebPKI's slow move on PQ certificates is a rational one. The work in progress is about **shrinking the chain** (Merkle-tree certificates, intermediate suppression, abridged certificate compression) rather than simply swapping the algorithm.

### 5.5 "Harvest now, decrypt later"

The threat model that makes all of this urgent today, despite the absence of a quantum computer:

> **An adversary records encrypted traffic now, stores it, and decrypts it when a cryptographically relevant quantum computer becomes available.**

The economics are trivially favourable to the attacker: bulk storage is cheap and getting cheaper, interception at scale is a solved engineering problem for nation-state adversaries, and there is no cost to being wrong about the timeline. Every recorded TLS session protected by X25519 or RSA key exchange is, under this model, **already compromised** — the compromise simply has not been executed yet.

The decision rule is one inequality, and it is the clearest way to think about migration urgency (it is essentially **Mosca's theorem**):

```
If  (how long your data must stay secret)  +  (how long your migration takes)
      >  (time until a quantum computer exists)
then you are already late.
```

Concretely: medical records (decades), state secrets (decades to permanent), genomic data (permanent, and implicates relatives), identity documents, legal and financial records, long-lived firmware signing roots. A system holding thirty-year secrets with a five-year migration programme is late if a quantum computer arrives before 2061 — which is not a bet anyone should take.

**Note the asymmetry that follows from §5.4 and is worth restating as the practical conclusion:**

| | Vulnerable to harvest-now-decrypt-later? | Urgency |
|---|---|---|
| **Confidentiality / key exchange** | **Yes** — recorded traffic is decrypted retroactively | **Now** |
| **Authentication / signatures** | **No** — forging a signature after the session is over accomplishes nothing | Before the machine exists |
| **Long-lived signature roots** (firmware, code signing, CA roots with 25-year lifetimes) | Yes, in a different sense: a root you deploy today must still be unforgeable in 2050 | **Now**, and this is what SLH-DSA is for |

Signal's **PQXDH** (deployed 2023, and the first large-scale post-quantum deployment in a messenger) adds a CRYSTALS-Kyber/ML-KEM encapsulation alongside the X3DH exchange (§4.3) for exactly this reason: messages sent today should not be readable in 2040. Apple's **PQ3** in iMessage (2024) went further, adding a post-quantum *ratchet* so that PQ protection is re-established periodically rather than only at session setup.

### 5.6 The dated summary, and when to re-check

**As of September 2026:**

| Question | Answer |
|---|---|
| Are the standards final? | FIPS 203/204/205: **yes, 13 August 2024**. FIPS 206 (FN-DSA/FALCON): **draft**. HQC: **selected March 2025, standard not yet final** |
| What should I use for key exchange? | **X25519MLKEM768 hybrid** (codepoint 4588). Enable it; it is already the default in Chrome and Firefox |
| What should I use for signatures? | Still Ed25519/ECDSA for TLS. **ML-DSA-65** where PQ signatures are needed. **SLH-DSA** for long-lived roots and firmware |
| Should I go PQ-only? | **No.** Hybrid, for the SIKE reason (§5.3) |
| Is symmetric crypto in trouble? | **No.** Use AES-256 for long-lived data and stop worrying |
| Does a quantum computer exist that threatens RSA-2048? | **No**, publicly, and the gap is three to four orders of magnitude in qubit count |
| What is the regulatory deadline? | NIST IR 8547 proposes deprecation of RSA/ECC after **2030**, disallowed after **2035** |

**Re-check trigger.** Treat this section as stale if any of the following is true: it is more than six months after September 2026; a FIPS 206 or HQC final standard has been announced; a new NIST additional-signatures selection has been announced; or any lattice cryptanalysis result has been published that changes ML-KEM/ML-DSA parameter recommendations. The three sources to re-check against, in order: **csrc.nist.gov/projects/post-quantum-cryptography**, the **IANA TLS Supported Groups registry** for what has actually been assigned and deployed, and **Cloudflare Radar's adoption page** for real deployment share.

---

## 6. Crypto and the hardware

This is the section that earns cryptography a place in a hardware curriculum. Crypto is one of the very few workloads that got its **own instructions in every mainstream ISA**, and it is the only workload in this entire curriculum where **the correct implementation is deliberately slower than the fastest one** — where an optimisation that a compiler would happily apply is a security bug. Both of those facts are about hardware, and both are worth a serious engineer's attention.

### 6.1 AES-NI and the order of magnitude

Before 2010, software AES was either a T-table implementation (fast, and leaking the key through the cache, §2.3) or a bitsliced one (constant-time, and complicated). Intel's response, shipping with **Westmere (2010)**, was to put the round function in the instruction set.

**The six instructions** are a remarkably direct mapping of §2.3's round structure onto silicon:

| Instruction | Does |
|---|---|
| `AESENC xmm1, xmm2` | One full middle round: ShiftRows, SubBytes, MixColumns, then XOR the round key in xmm2 |
| `AESENCLAST` | The final round: ShiftRows, SubBytes, AddRoundKey — **no MixColumns**, exactly as §2.3 requires |
| `AESDEC`, `AESDECLAST` | The inverse rounds (using the equivalent-inverse-cipher formulation) |
| `AESKEYGENASSIST` | The `RotWord`/`SubWord`/`Rcon` step of the key schedule |
| `AESIMC` | InvMixColumns, for converting an encryption key schedule into a decryption one |

So a full AES-128 block encryption is:

```asm
    pxor        xmm0, [rk+0]        ; AddRoundKey, round 0
    aesenc      xmm0, [rk+16]       ; rounds 1..9
    aesenc      xmm0, [rk+32]
    ...                             ; nine AESENC total
    aesenclast  xmm0, [rk+160]      ; round 10
```

**Eleven instructions for a 128-bit block.** That is the whole cipher.

**The numbers**, and this is where the "order of magnitude" claim earns itself. Order-of-magnitude figures on a modern x86 core (Skylake-and-later class; measure on your own part):

| Implementation | Cycles per byte | Throughput at 3 GHz |
|---|---|---|
| T-table AES-128-CTR (and side-channel vulnerable) | ~10–15 | ~200–300 MB/s |
| Bitsliced constant-time AES (no AES-NI) | ~7–10 | ~300–450 MB/s |
| **AES-NI, single block, serial (CBC encrypt)** | **~4–5** | ~600–750 MB/s |
| **AES-NI, pipelined 8 blocks (CTR/GCM)** | **~0.6–0.8** | **~4 GB/s** |
| AES-256-GCM with AES-NI + PCLMULQDQ, VAES on newer parts | ~0.3–0.5 | 6–10 GB/s |

**Roughly 10–20× over the table implementation, and the constant-time version got *faster* than the leaky one.** That is the central point: AES-NI did not just accelerate AES, it **removed the security/performance trade-off**, because the instructions are single-cycle-throughput, fixed-latency, and touch no data-dependent memory. Constant-time AES stopped being something you sacrificed speed for and became the fast path.

**The pipelining detail is the interesting engineering.** On Skylake-class parts `AESENC` has **latency ~4 cycles and reciprocal throughput ~1 cycle** — you can start one every cycle but each takes four to finish. In a *serial* chain (CBC encryption, where block *i* depends on block *i−1*) you are latency-bound: 10 rounds × 4 cycles = 40 cycles per 16-byte block ≈ 2.5 cycles/byte, and the unit sits idle three cycles out of four. In a *parallel* mode (CTR, GCM, or CBC **decryption**) you interleave 8 independent blocks in 8 registers, filling the pipeline completely, and reach ~1 cycle per `AESENC` — the ~0.6 cycles/byte figure.

That gap is the best concrete illustration in this whole curriculum of latency-versus-throughput on a real functional unit, and it has a direct security-relevant consequence: **CBC is slower than CTR not because of the cipher but because of the data dependency**, and the mode that is cryptographically better is also the one that maps onto the pipeline better. That coincidence is not luck — CTR and GCM were designed with parallel hardware in mind.

**The rest of the landscape:**

- **VAES / AVX-512** (Ice Lake and later, and on AMD from Zen 4) widens the AES instructions to 256- and 512-bit vectors, processing 2 or 4 blocks per instruction. This roughly doubles or quadruples throughput again for parallel modes.
- **SHA extensions** (`SHA1RNDS4`, `SHA1NEXTE`, `SHA256RNDS2`, `SHA256MSG1/2`) shipped on Intel Goldmont and AMD Zen (2017), and much later on mainstream Intel big cores. They give roughly **3–5×** on SHA-256, taking it from ~10 cycles/byte to ~2. Notably, AMD shipped them a *long* time before Intel's performance cores did, which is why "does this machine have SHA-NI" was for years a real dispatch question. SHA-512 extensions arrived later still (Arrow Lake / Lunar Lake era).
- **Detection is mandatory and is not optional plumbing.** `CPUID.01H:ECX.AESNI[bit 25]`, `CPUID.07H:EBX.SHA[bit 29]`, `CPUID.01H:ECX.PCLMULQDQ[bit 1]`. Every real library dispatches at runtime — one binary, several implementations, chosen once at init. This is where the "portable fallback must also be constant-time" rule bites: your bitsliced path is not a nice-to-have, it is what runs on the machine without the extensions, and it is a security-relevant code path.

### 6.2 PCLMULQDQ and GHASH

AES-NI accelerates half of AES-GCM. The other half is **GHASH**, which is polynomial arithmetic in GF(2^128) (§2.8) — and GF(2) polynomial multiplication is *carry-less* multiplication: the same shift-and-add structure as integer multiplication, but with XOR instead of addition, so no carries propagate.

General-purpose CPUs have no carry-less multiplier, so software GHASH was either **table-driven** (typically a 4-bit or 8-bit windowed table of multiples of H — fast, and **key-dependent table lookups**, which is the §2.3 cache-timing problem again, this time leaking the authentication key) or a bit-serial loop (constant-time and painfully slow, tens of cycles per byte).

**`PCLMULQDQ`** (Westmere, 2010, alongside AES-NI) computes a 64×64 → 128-bit carry-less product of selected halves of two XMM registers. A 128×128 carry-less multiply is then four `PCLMULQDQ`s (or three, using Karatsuba), followed by a reduction modulo `x^128 + x^7 + x^2 + x + 1`, which is itself two more carry-less multiplies by the reduction constant.

The results:

| GHASH implementation | Cycles per byte |
|---|---|
| Bit-serial, constant-time | ~30–50 |
| 8-bit table, **not constant-time** | ~2–5 |
| **PCLMULQDQ, aggregated reduction** | **~0.3–0.5** |

Again: the constant-time hardware path beats the leaky software optimisation by roughly an order of magnitude. **AES-GCM as a fast AEAD only exists because both halves got instructions in the same CPU generation.** If PCLMULQDQ had not shipped, GCM would have been a slow mode with an awkward side-channel story, and the world would probably have standardised on something else.

Two implementation notes worth carrying:

- **Aggregated reduction** is the standard optimisation: instead of multiply-and-reduce per block, accumulate several blocks' products with precomputed powers of H (`H, H², H³, ... H⁸`) and perform **one** reduction per batch. It converts GHASH from a serial dependency chain into a parallel one, matching the AES pipelining above — which is why the AES and GHASH halves of GCM can be interleaved into one loop that keeps both units busy. Intel's "Carry-Less Multiplication and Its Usage for Computing the GCM Mode" white paper (2010, revised 2014) is the reference and is genuinely readable.
- **`VPCLMULQDQ`** on AVX-512 parts does four carry-less multiplies per instruction, which is what pushes modern AES-GCM under 0.3 cycles/byte.

### 6.3 ARM crypto extensions

ARMv8-A's optional **Cryptographic Extension** provides the same shape, and it is why phones stopped needing ChaCha20 for performance reasons:

| Instruction | Does |
|---|---|
| `AESE Vd, Vn` | AddRoundKey then SubBytes then ShiftRows |
| `AESMC Vd, Vn` | MixColumns |
| `AESD`, `AESIMC` | The decryption counterparts |
| `PMULL`, `PMULL2` | Polynomial (carry-less) multiply — the PCLMULQDQ equivalent, for GHASH |
| `SHA1C/P/M/H`, `SHA1SU0/1` | SHA-1 rounds and message schedule |
| `SHA256H`, `SHA256H2`, `SHA256SU0/1` | SHA-256 |
| `SHA512H/H2/SU0/SU1`, `SM3`, `SM4`, `EOR3`, `RAX1`, `BCAX`, `XAR` | ARMv8.2/8.4 additions — SHA-512, the Chinese national algorithms, and helpers for SHA-3/Keccak |

The split between `AESE` and `AESMC` is a real design difference from x86, and a good one to notice: ARM separates the round into two instructions, which lets the implementation **fuse** them. Most ARM cores macro-fuse an adjacent `AESE`/`AESMC` pair into a single operation, so the sequence costs about what x86's single `AESENC` costs — but the split also lets the final round (no MixColumns) be expressed without a separate instruction, and lets the two halves be scheduled independently on cores that do not fuse.

Availability: the extension is **optional** in ARMv8-A, and that mattered enormously in practice. Early ARMv8 parts and many low-cost SoCs shipped without it; the Raspberry Pi is the canonical example — **the Cortex-A72 in the Pi 4 does not implement the crypto extensions**, so AES on a Pi 4 is software AES, and ChaCha20-Poly1305 is meaningfully faster there. (The Pi 5's Cortex-A76 does implement them.) On Linux, `/proc/cpuinfo` lists `aes`, `pmull`, `sha1`, `sha2` in the Features line, and `getauxval(AT_HWCAP)` with `HWCAP_AES` etc. is the programmatic check. **This is exactly why TLS 1.3 keeps both AES-GCM and ChaCha20-Poly1305 mandatory and lets the client order them by its own hardware (§2.8).**

Apple silicon implements the extensions throughout, and adds its own accelerators in the Secure Enclave (§6.8). RISC-V has ratified scalar (Zkn) and vector (Zvkn) crypto extensions with the same intent; deployment is early.

### 6.4 Constant-time implementation as a discipline

This is the most important subsection in §6, because it is where the hardware knowledge from the rest of this curriculum becomes a security requirement rather than a performance concern.

**The rule:** the *time* an implementation takes, and the *memory addresses* it touches, must not depend on secret data. The attacks that make this necessary — cache timing, branch prediction, port contention, Spectre-class transient execution — are `hardware-security.md`'s subject. The **engineering discipline** is this document's.

**The three forbidden things:**

1. **No branch on a secret.** `if (secret_bit)` produces different timing via branch prediction and different instruction cache behaviour.
2. **No memory access at a secret-dependent address.** `table[secret_byte]` selects a cache line, and which line was touched is observable — this is the T-table story (§2.3) and the GHASH-table story (§6.2).
3. **No variable-latency instruction on secret data.** Integer division is the notorious one (latency depends on operand values on many cores). On some older or embedded cores, multiplication is too — early ARM cores had early-terminating multipliers whose latency depended on operand magnitude, which broke bignum code in exactly the way you would fear.

**The techniques**, which is what the discipline actually consists of:

*Select without branching* — compute both sides and pick with a mask:

```c
/* Return a ? x : y, in constant time.  a must be 0 or 1. */
uint32_t ct_select(uint32_t a, uint32_t x, uint32_t y) {
    uint32_t mask = -(uint32_t)a;      /* 0x00000000 or 0xFFFFFFFF */
    return (x & mask) | (y & ~mask);
}
```

*Compare without early exit* — accumulate differences, then reduce:

```c
int ct_memcmp(const void *a, const void *b, size_t n) {
    const unsigned char *x = a, *y = b;
    unsigned char d = 0;
    for (size_t i = 0; i < n; i++) d |= x[i] ^ y[i];   /* no branch, no early return */
    return d;                                          /* 0 iff equal */
}
```

Compare that with `memcmp`, which returns on the first differing byte. As §2.9 said, that early return converts MAC verification into a byte-at-a-time forgery oracle. This is the single most common constant-time bug in application code and §7's Unit 3 exercise is to write the above and **verify in the emitted assembly** that no conditional branch depends on the data.

*Table lookup without an address leak* — read the whole table and mask:

```c
uint8_t ct_lookup(const uint8_t *tab, size_t n, size_t idx) {
    uint8_t r = 0;
    for (size_t i = 0; i < n; i++)
        r |= tab[i] & (uint8_t)(-(uint8_t)(i == idx));  /* touches every entry */
    return r;
}
```

Linear in the table size, which is why a 256-entry S-box done this way is slow and why bitslicing (which has no table at all) is the real answer for software AES.

#### What the compiler may do to your careful code

**This is the part that surprises people, and it is the reason constant-time programming is a hardware-and-toolchain topic rather than a coding-style topic.**

The C abstract machine has **no notion of time**. Nothing in the standard says your program must take a data-independent amount of time. Therefore **every constant-time property you write is invisible to the compiler and unprotected by the language**, and an optimiser is entirely within its rights to destroy it:

- **Re-introducing a branch.** A sufficiently smart compiler recognises `(x & mask) | (y & ~mask)` as a select and may emit a `cmov` (fine) — or may emit a *compare and branch* (not fine), if its cost model prefers that on the target. This is not hypothetical; it has been observed in real compilers on real constant-time code, and it is the motivating example in Kaufmann et al., "When Constant-Time Source Yields Variable-Time Binary" (2016), where a specific MSVC/x86 codegen turned a constant-time Curve25519 into a variable-time one.
- **Short-circuiting a loop.** An optimiser that can prove the accumulator in `ct_memcmp` is already nonzero has no obligation to keep iterating.
- **Removing your key zeroisation.** `memset(key, 0, len)` immediately before the buffer goes out of scope is a **dead store** by the abstract machine's rules, and compilers delete it. The key stays in memory, and then in swap, in a core dump, in a heap-spray. The fixes: `memset_s` (C11 Annex K, patchily available), `explicit_bzero` (BSD/glibc), `SecureZeroMemory` (Windows), `sodium_memzero` (libsodium), or a hand-rolled volatile-pointer loop or an empty asm barrier. **Never plain `memset`.**
- **Vectorising or unrolling** in ways that change memory access patterns.
- **Constant-folding secret-dependent code** if the secret is visible at compile time in a test harness — which is why microbenchmarks of constant-time code are misleading.
- **`-ffast-math`, LTO, and PGO** all expand what the optimiser knows and can therefore change.

**The consequences for how you must work:**

1. **Verify the assembly, not the source.** Constant-time-ness is a property of the emitted code. This is why §7's exercise checks the disassembly and why the Compiler Explorer API is the right tool for teaching it.
2. **Use barriers the compiler cannot see through.** The common idiom is an empty inline asm with the value as an input/output operand, which forces the compiler to materialise the value and forget what it knows about it:
   ```c
   static inline uint32_t opt_barrier(uint32_t x) {
       __asm__ __volatile__("" : "+r"(x) : : "memory");
       return x;
   }
   ```
3. **Use the tools that check it.** `ctgrind` (a Valgrind patch that marks secrets as uninitialised, so Valgrind's existing "branch on uninitialised value" machinery becomes a constant-time checker — an inspired hack), `dudect` (statistical timing measurement, no source annotation needed), `ct-verif`/`FaCT`, and Binsec/Rel for binary-level verification.
4. **Or write the assembly.** Which is what the serious libraries do.

#### Why libsodium and BearSSL are structured as they are

Both libraries are worth reading, and their *architectures* are arguments about the above.

**libsodium** (Frank Denis, a portable fork of Bernstein, Lange and Schwabe's NaCl):

- **A tiny, opinionated API.** `crypto_secretbox_easy`, `crypto_box_easy`, `crypto_sign`, `crypto_pwhash`. There is no cipher selection, no mode selection, no padding choice, no IV parameter to get wrong. **The API surface is the security argument** — this is §3.6's philosophy applied to a whole library. Compare OpenSSL's EVP interface, where every one of those is a call the caller can get wrong.
- **Misuse-resistant defaults**: XChaCha20-Poly1305 with a 192-bit nonce so random nonces are safe (§2.8), Argon2id for passwords with named difficulty presets, X25519 and Ed25519 with no curve choice.
- **Everything is constant-time**, and the primitives were *chosen* for that: ChaCha20 and Poly1305 are ARX with no tables, Curve25519 uses the Montgomery ladder, and the fallback AES path is not exposed as a general-purpose primitive at all.
- **`sodium_memzero`, `sodium_malloc`** with guard pages and `mlock`, `sodium_memcmp` constant-time — the memory hygiene is built into the API rather than left to the caller.
- Runtime CPU dispatch to AES-NI/AVX2 implementations where available.

**BearSSL** (Thomas Pornin) makes the opposite trade-off in a different dimension and is the more instructive read for this curriculum:

- **Constant-time is a hard, stated, global invariant.** Pornin's design goal was that *every* operation on secret data in the entire library is constant-time, including the bignum code and including RSA — which is much harder than doing it for a curated set of modern primitives.
- **No dynamic allocation at all.** Everything is caller-provided buffers. That makes it fit in tiny embedded targets, but the security reason is as important: no heap means no allocator timing, no fragmentation-dependent behaviour, no use-after-free of key material, and a fully bounded memory footprint you can reason about.
- **Multiple implementations of each primitive, explicitly labelled by their trade-off** — `br_aes_ct`, `br_aes_ct64`, `br_aes_small`, `br_aes_big`, `br_aes_x86ni`, `br_aes_pwr8`. The library *names* the fact that "big" (table-based) is fast and leaky and "ct" is slower and safe, and makes the caller's dispatcher choose. Most libraries hide this; BearSSL makes it part of the API, which is a much better teaching artefact.
- **A minimal, auditable, single-purpose codebase** aimed at embedded TLS where you cannot afford OpenSSL and cannot afford a side channel.

**The generalisable point, and it is the sentence this whole section exists for:**

> **In cryptography, the fastest correct-by-output implementation is frequently insecure, and the secure implementation is deliberately slower.** T-tables beat bitslicing; `memcmp` beats `ct_memcmp`; windowed exponentiation beats a Montgomery ladder; a data-dependent branch beats a masked select. In every case the faster code is the one that leaks. Every other workload in this curriculum optimises for speed subject to correctness; this one optimises for **speed subject to correctness and the absence of an observable data dependency** — and that second constraint is invisible to the language, the compiler, the test suite, and the profiler.

### 6.5 Bignum arithmetic and Montgomery multiplication

RSA and finite-field DH need arithmetic on 2048–4096-bit integers; elliptic curves need 256–521-bit field arithmetic. Neither fits in a register, so both are built on **multi-precision (bignum) arithmetic** over arrays of 32- or 64-bit "limbs".

The building blocks, and their hardware hooks:

- **Addition** with carry propagation: `ADC` on x86, and the ILP-friendly `ADCX`/`ADOX` pair (Broadwell, 2014) which use the carry and overflow flags as *two independent carry chains*, letting two addition chains run in parallel instead of serialising on the single carry flag. That is a beautiful and very specific example of an ISA extension existing for one workload.
- **Multiplication**: `MULX` (BMI2) — a 64×64→128 multiply that **does not touch the flags**, so it interleaves freely with `ADCX`/`ADOX`. The combination is what modern bignum code is written around.
- **Reduction modulo N**: the expensive part. A schoolbook `%` on a 4096-bit number means a full multi-precision division, and division is both slow and (on many cores) **variable-latency in a way that depends on the operands** — which, on secret data, is forbidden by §6.4.

**Montgomery multiplication** (Peter Montgomery, *Mathematics of Computation*, 1985) is the standard answer, and it is one of the genuinely elegant algorithms in the field. The idea:

> Work in a transformed representation where **modular reduction becomes a shift instead of a division**.

Choose `R = 2^(64k) > N`, coprime to N (so N must be odd — true for RSA moduli and for prime fields). Represent *a* as its **Montgomery form** `ā = aR mod N`. Then define

```
MontMul(ā, b̄) = ā·b̄·R⁻¹ mod N
```

which, because `ā·b̄ = abR²`, yields `abR mod N` — the Montgomery form of `ab`. The representation is closed under the operation.

The algorithm, `REDC`, computes `T·R⁻¹ mod N` without any division:

```
Precompute:  N' = −N⁻¹ mod R          (once per modulus, by Newton iteration mod 2^64)
REDC(T):     m = ((T mod R) · N') mod R      ← a multiply and a mask; R = 2^k so "mod R" is free
             t = (T + m·N) / R               ← the division is an exact shift, because
                                               T + m·N ≡ 0 (mod R) by construction of m
             if t ≥ N: t -= N                ← at most ONE conditional subtraction
             return t
```

Every "mod R" is a bitmask and every "/R" is a shift, because R is a power of two. **The expensive division is gone.** The cost is the conversion in and out (`a → aR mod N` is one Montgomery multiply by the precomputed `R² mod N`), which is why Montgomery form pays off for **modular exponentiation** — you convert once, do a thousand modular multiplications in the transformed domain, and convert back once.

The operation-count comparison, which is §7's Unit 3 exercise:

| | Modular multiply cost |
|---|---|
| Schoolbook `(a*b) % N` | 1 multi-precision multiply + **1 multi-precision division** |
| Montgomery | **2 multi-precision multiplies + shifts/masks**, no division |

A multi-precision division is roughly an order of magnitude more expensive than a multiply of the same size, so trading one division for one extra multiply is a large win — typically **2–4× on modular exponentiation** overall, which is a direct 2–4× on RSA.

**Three points that connect it back to §6.4:**

1. **That final conditional subtraction is a side channel.** "If t ≥ N, subtract" is a branch on a value derived from secret data, and its presence or absence has been used in real attacks. The fix is **constant-time conditional subtraction** — always compute `t − N`, and select between `t` and `t − N` with a mask, exactly as `ct_select` does. Alternatively, use the well-known result that with `R > 4N` the subtraction can be deferred entirely.
2. **The exponentiation loop must not branch on exponent bits.** Naive square-and-multiply does a multiply only when the exponent bit is 1, so the multiply count reveals the Hamming weight of the private exponent and the *pattern* reveals the bits. The countermeasures are the **Montgomery ladder** (always one square and one multiply per bit) or **fixed-window exponentiation with a constant-time table lookup** — and the table lookup must be the masked kind from §6.4, not an indexed load, or you have re-created the T-table leak. Kocher's original timing attack (CRYPTO 1996) was exactly against this.
3. **RSA blinding.** Even with all of the above, the standard defence is to multiply the ciphertext by `r^e` for random *r* before decrypting and divide by *r* afterwards, so the attacker cannot control or predict the values the secret-dependent code operates on. This defeats both timing and many fault attacks and costs one extra exponentiation-sized operation per decrypt. Every serious RSA implementation does it.

**Alternatives worth knowing:** for the specific primes used by modern curves — `2^255 − 19`, `2^256 − 2^224 + 2^192 + 2^96 − 1` (P-256), `2^448 − 2^224 − 1` — the reduction is so cheap (a few shifts, adds and a multiply by a small constant) that **Montgomery form is not used at all**; curve code uses specialised reduction routines for its specific prime. This is why the pseudo-Mersenne prime choice in §3.6 was listed as a *design decision for constant time*, not just for speed. Montgomery's domain is the general modulus case: RSA, and finite-field DH, where the modulus is arbitrary.

### 6.6 GPU crypto, and where it does and does not help

The instinct that a GPU with 10,000 cores should be a cryptographic monster is right for exactly one shape of problem and wrong for almost everything real.

**Where GPUs win:**

| Workload | Why |
|---|---|
| **Password cracking** | Millions of *independent* hashes, no dependencies, no shared state. This is the canonical case and it is why §2.12's memory-hardness argument exists. Hashcat on a modern GPU does on the order of 10^10 SHA-256/s versus ~10^8 on a CPU core |
| **Brute force and cryptanalysis** | Same shape: embarrassingly parallel search |
| **Batch signature verification** | Thousands of independent verifications — real for blockchain nodes and CT log auditors |
| **Bulk encryption of huge independent datasets** | Only when the data is *already* on the GPU |
| **Lattice/PQC research and batch KEM operations** | NTT-heavy arithmetic vectorises well |

**Where GPUs lose, and the reasons are structural:**

1. **PCIe transfer dominates.** To encrypt data on the GPU you must move it there and back. At ~25–60 GB/s over PCIe 4/5 against a CPU that does AES-GCM at 4–10 GB/s *per core*, the transfer costs more than the computation. A multi-core CPU encrypts faster than you can hand the data to the GPU. **This is the whole answer for bulk encryption**, and it is the same arithmetic-intensity argument that governs every other accelerator decision in this curriculum: AES has an arithmetic intensity of a handful of operations per byte, which is exactly the regime where the bus wins.
2. **Latency, not throughput, is what most crypto needs.** A TLS handshake needs *one* key exchange to complete in microseconds. A GPU gives you a million of them in milliseconds. Batching a latency-critical operation to fill a GPU is the wrong shape.
3. **No AES instructions.** GPUs have no AES-NI equivalent, so they run the T-table or bitsliced software algorithm. A CPU with dedicated silicon beats a GPU running general-purpose ALU code, per watt and often outright.
4. **Divergence.** SIMT execution serialises divergent branches within a warp, and cryptographic code is branch-heavy in exactly the places that matter.
5. **Constant-time is much harder and largely unstudied.** GPU cache and scheduling behaviour is less documented, timing is noisier but not absent, and there is no equivalent of the CPU constant-time toolchain. **Handling long-term secret keys on a GPU is not something to do casually.**

**The honest summary:** GPUs are the *attacker's* tool in cryptography far more than the defender's. The defender's answers are the CPU instructions in §6.1–6.3, and — for the one case where the defender genuinely needs bulk throughput at scale — dedicated crypto offload: **AES-XTS engines in NVMe controllers and SEDs, IPsec/MACsec offload in NICs (Intel QuickAssist, Mellanox/NVIDIA ConnectX inline TLS), and the crypto engines in essentially every SoC.** Those sit in the data path, so they have no transfer cost.

### 6.7 Where the crypto actually runs in a modern system

Worth stating explicitly, because it changes how you think about key handling:

| Layer | Crypto |
|---|---|
| **NVMe SSD / SED** | AES-XTS in the controller, at full link speed, key from the drive's own key store (OPAL/TCG) |
| **NIC** | IPsec, MACsec, and inline TLS record encryption offload |
| **CPU** | AES-NI/ARM-CE for TLS, disk encryption above the block layer (dm-crypt, FileVault, BitLocker) |
| **Chipset / platform** | TPM: measured boot, key sealing, attestation |
| **SoC secure enclave** | Apple SEP, ARM TrustZone, AMD PSP, Intel CSME — key storage and operations isolated from the main OS |
| **HSM / smartcard / TPM** | Long-term keys that must never exist in host memory |

### 6.8 Secure elements, TPMs and HSMs

Everything above assumes the key is in RAM, where any sufficiently privileged code — or a cold-boot attack, or a core dump, or a Heartbleed-shaped read primitive — can take it. Hardware key storage exists to break that assumption.

**The single defining property**, common to all of these devices:

> **The private key is generated inside the device and never leaves it.** You do not send the device a key; you send it *data* and it sends back a signature or a decryption. The key is not extractable through the API at all, by anyone, including you.

That converts key theft from "read some memory" into "physically attack a tamper-resistant device", and it converts an unlimited offline attack into a **rate-limited online one** — which is the underrated half of the benefit. A stolen 6-digit PIN database is instantly cracked; a 6-digit PIN protected by a secure element that wipes after ten attempts is not, and that is the entire basis of smartphone data protection.

**The families:**

| Device | Typical use | Notes |
|---|---|---|
| **Smartcard / SIM / YubiKey** | Personal auth, FIDO2/WebAuthn, PIV, code signing | Cheap, standardised (ISO 7816, PKCS#11, CTAP2), physically portable |
| **TPM** (TCG spec, TPM 2.0) | Measured boot, disk-encryption key sealing, platform attestation, machine identity | On essentially every business PC; **sealing** binds a key to a set of PCR measurements so it only unseals if the boot chain is unchanged. This is what BitLocker without a PIN relies on |
| **Secure enclave** (Apple SEP, ARM TrustZone, Google Titan M) | Phone key storage, biometrics, rate limiting | Deeply integrated; the SEP holds the class keys for file protection and enforces the passcode attempt limit |
| **HSM** (Thales, Utimaco, AWS CloudHSM, YubiHSM) | CA root keys, payment (PIN blocks, EMV), code signing, key management at scale | FIPS 140-3 validated to Level 3 (tamper-evident and tamper-responsive — it zeroises on physical intrusion). Thousands to hundreds of thousands of operations/second. Expensive |
| **Cloud KMS** (AWS KMS, GCP KMS, Azure Key Vault) | The common case in practice | HSM-backed, API-fronted. Convenient, and you are trusting the provider's boundary rather than one you hold |

**The honest limitations**, because "put it in an HSM" is often stated as if it ends the discussion:

- **The device performs any operation it is asked to.** Malware with API access to your HSM cannot steal the key but can sign anything it likes for as long as it has access. **The key is protected; the *authority* is only as protected as the host.** Access control, quorum/dual-control, and logging are what actually limit the damage, and they live outside the device.
- **Performance is often the binding constraint.** A CA's HSM doing 1,000 signatures/second is a hard ceiling on issuance, and it is why high-volume systems keep intermediate keys in HSMs and do bulk work elsewhere.
- **Side channels apply to secure hardware too.** Power and EM analysis and fault injection are the *classical* attacks on smartcards, which is why FIPS 140-3 Level 3+ and Common Criteria evaluation exist and why the details belong to `hardware-security.md`.
- **They are not immune to logic bugs.** TPM-FAIL (2019) recovered ECDSA keys from Intel fTPM and STMicro TPMs via nonce timing (§1.6); ROCA (2017) broke RSA keys generated *inside* Infineon smartcards and TPMs because the on-device key generation was flawed (§3.4). **"It happened in hardware" is not "it was done right."**
- **Attestation is the feature people forget to use.** A TPM or FIDO2 device can prove to a relying party that a key was generated in genuine hardware and is non-extractable. That is a genuinely strong property and it is what makes passkeys' security claims meaningful.

**The design rule:** put keys in hardware when the key's *lifetime* is long relative to the host's trustworthiness — CA roots, code-signing keys, device identity, user authentication credentials. Do not put an ephemeral TLS session key in an HSM; it will be slower and it protects nothing, because the key exists for seconds and the plaintext is in host memory anyway.

---

## 7. Curriculum

Three units in dependency order. Each has **one idea**, and the exercises exist to make that idea impossible to hold wrongly. §4 (protocols) and §5 (post-quantum) attach as a seminar-style fourth session rather than a unit with exercises — they are reading and discussion, not code.

**The instruction that goes on every exercise in this section, and it is not a formality:**

> **You are writing these to understand them. None of this code should ever be deployed.** Every exercise here produces something that passes its test vectors and is still unsafe to ship — non-constant-time, no nonce management, no key hygiene, no review. §1.4 explains exactly why the passing test is not evidence. Production code uses a reviewed library: libsodium if you get to choose, your platform's or your language's standard crypto if you do not, BoringSSL/OpenSSL if you must interoperate. **The value of writing AES is that you will never again believe that "we used AES-256" tells you anything.**

### 7.1 Unit 1 — The cipher is not the system

> **THE ONE IDEA: a block cipher gives you confidentiality of a single block and nothing else. Everything that determines whether a system is secure lives in how the cipher is used, not in the cipher.**

**Prerequisites:** C or C++, bitwise operations, and the willingness to read a twelve-page spec.

**Covers:** §1.1–1.5 (the four properties, Kerckhoffs, threat models, why not to roll your own, computational vs information-theoretic security), §2.1–2.3 (block ciphers, SPNs, AES), §2.5 (ECB).

**Session shape.** Start with §1.1's table — four properties, four mechanisms — and the claim that encryption provides exactly one of them. Then the one-time pad and Shannon's theorem, because it establishes both the ceiling (perfect secrecy exists) and the price (a key as long as the message), and because the two-time pad it warns about is Unit 2's entire subject. Then AES from FIPS 197. Finish with ECB, which is where the unit's one idea lands: **the same cipher, correctly implemented, used two different ways, is either secure or a picture of a penguin.**

**Exercise 1.1 — AES-128 against the FIPS-197 vectors.**
Implement AES-128 encryption from FIPS 197: generate the S-box from its algebraic definition (multiplicative inverse in GF(2^8), then the affine map — do not paste a table), the key schedule, and the round function. **Assert** the ciphertext for the Appendix C.1 vector (key `000102…0f`, plaintext `00112233445566778899aabbccddeeff`) equals `69c4e0d86a7b0430d8cdb78070b4c55a`, and that the Appendix B worked example (key `2b7e1516…`, plaintext `3243f6a8…`) gives `3925841d02dc09fbdc118597196a0b32`. Also **assert** three known S-box entries (`S[0x00]=0x63`, `S[0x53]=0xed`, `S[0xff]=0x16`) so that a wrong field polynomial fails loudly.

*Why generate the S-box rather than paste it:* it forces you through GF(2^8), which is the only genuinely unfamiliar mathematics in AES, and it makes the affine step's purpose (§2.3) concrete.

*Expected failure, and it is the point of the exercise:* almost everyone gets **column-major state ordering** wrong on the first attempt, and almost everyone forgets that **the final round has no MixColumns**. Both bugs round-trip perfectly with a matching decryptor and fail every test vector. **Say out loud what just happened: the implementation was self-consistent, reversible, produced random-looking output, and was wrong.** That is §1.4 reason 2, discovered rather than asserted.

**Exercise 1.2 — ECB's failure, as a passing assertion.**
Using the AES from 1.1, encrypt a 32-byte plaintext consisting of the same 16 bytes twice (`"YELLOW SUBMARINE"` twice is traditional). **Assert `memcmp(ct, ct+16, 16) == 0`.** Then do the same input under CBC with a random IV and **assert the two ciphertext blocks differ.**

The assertion that passes is the vulnerability. Follow it by encrypting a small BMP's pixel data in ECB and looking at the result.

*Verified on Compiler Explorer (GCC 13.2, x86-64, `-O2 -std=c++17`), September 2026:*
```
S-box generated from GF(2^8) inverse + affine map: OK
ciphertext = 69c4e0d86a7b0430d8cdb78070b4c55a   (matches FIPS-197 C.1)
appendixB  = 3925841d02dc09fbdc118597196a0b32   (matches FIPS-197 Appendix B)
ECB block0 = 761ab98c7086c509261f322cb3ffa7d9
ECB block1 = 761ab98c7086c509261f322cb3ffa7d9   <- identical, as asserted
CBC on the same input: blocks differ, as required
ALL PASS
```

**Discussion questions.** Why must a block cipher be a bijection, and what does that forbid? Why does the last round drop MixColumns? What exactly does the penguin leak, and what does it *not* leak? If ECB is never correct for messages, why does every crypto library still expose it?

### 7.2 Unit 2 — Uniqueness is load-bearing

> **THE ONE IDEA: cryptography's worst failures are not broken algorithms. They are a value that had to be used once being used twice.**

This is the unifying unit, and its power is that four apparently unrelated disasters are **the same bug**: the VENONA two-time pad, CTR nonce reuse, GCM nonce reuse, and the Sony/Android ECDSA nonce. Teach them as one idea and they stop being trivia.

**Prerequisites:** Unit 1.

**Covers:** §1.6 (randomness, CSPRNGs, and all three failure stories), §2.6 (CBC and padding oracles), §2.7 (CTR), §2.8 (AEAD, GCM's nonce catastrophe, ChaCha20-Poly1305, GCM-SIV), §2.9 (Encrypt-then-MAC), §2.11–2.12 (HKDF, Argon2), §3.7–3.8 (ECDSA's nonce, EdDSA's fix).

**Session shape.** Open with the three failure stories from §1.6 side by side and the table that shows they share a shape. Then CTR, and derive `C₁ ⊕ C₂ = P₁ ⊕ P₂` on the board — it is two lines and it is the whole unit. Then GCM, and show that the *same* mistake costs strictly more (the authentication key, permanently). Then ECDSA, and show that the same mistake there costs the private key. Close on the fixes, and note that **every durable fix removes the requirement instead of satisfying it more carefully**: AEAD instead of "remember to MAC", RFC 6979 and EdDSA instead of "use a good RNG", XChaCha20's 192-bit nonce instead of "manage your counter".

**Exercise 2.1 — CTR nonce reuse and two-time-pad recovery.**
Build CTR mode on Unit 1's AES (96-bit nonce ‖ 32-bit big-endian counter, as §2.7 specifies). Encrypt two different plaintexts **under the same key and the same nonce**. Then, holding only the two ciphertexts:
- **Assert** `C₁ ⊕ C₂ == P₁ ⊕ P₂` byte for byte — the key has left the equation.
- **Assert** that knowing `P₁` recovers `P₂` exactly.
- **Crib-drag**: with *neither* plaintext known, XOR a guessed word (`" the "`) at every offset and keep positions whose output is printable. **Assert** the drag at the true offset yields the correct fragment of the other message.
- **Assert** that with a distinct nonce, `C₁ ⊕ C₂` matches `P₁ ⊕ P₂` in essentially zero bytes.

*Verified on Compiler Explorer, September 2026:*
```
C1 XOR C2 == P1 XOR P2 exactly: the key is gone from the equation
recovered  : ATTACK AT DAWN. The password for the vault is hunter2, do not share.
actual P2  : ATTACK AT DAWN. The password for the vault is hunter2, do not share.
known-plaintext recovery of P2: PASS
crib " the " produced 9 printable candidate positions
dragging the crib at the true offset yields P1 fragment: "; thi"
with a distinct nonce, C1 XOR C2 matches P1 XOR P2 in 0 of 68 bytes
ALL PASS
```

**Exercise 2.2 — HMAC-SHA-256 against RFC 4231.**
Implement SHA-256 (FIPS 180-4) and HMAC (RFC 2104). **Assert** `SHA-256("abc") = ba7816bf…f20015ad`, then assert HMAC-SHA-256 against RFC 4231 test cases 1, 2, 3, 4, 6 and 7 — 6 and 7 matter because they exercise the "key longer than the block size, hash it first" path, which is the branch people omit. Finally **assert** that `SHA-256(key ‖ msg) ≠ HMAC(key, msg)`, and explain (via length extension) why the nested construction exists.

*Verified on Compiler Explorer, September 2026: all six RFC 4231 HMAC-SHA-256 vectors PASS.*
```
TC1  b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7  PASS
TC2  5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843  PASS
TC3  773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe  PASS
TC4  82558a389a443c0ea4cc819899f2083a85f0faa3e578f8077a2e3ff46729665b  PASS
TC6  60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54  PASS
TC7  9b09ffa71b942fcb27635fbcd5b0e944bfdc63644f0713938a7f51535c3a35e2  PASS
```

**Exercise 2.3 — ECDSA nonce reuse, on paper (no code required).**
Given `(r, s₁, z₁)` and `(r, s₂, z₂)`, derive `k` and then `d` (§1.6). Do it with pencil first; then, optionally, in Python with a small prime-order group so the arithmetic is checkable. **The point is that it is two modular inversions**, and that the repeated `r` makes affected signature pairs findable by a `GROUP BY` over any public signature corpus.

**Exercise 2.4 — Mersenne Twister is not a CSPRNG.**
Generate 624 consecutive `std::mt19937` outputs, untemper them to recover the internal state, and **assert** you predict the 625th exactly. Roughly thirty lines. It is the fastest possible demonstration of why "it looks random" is not a security property, and it is what makes §1.6's rule stick.

**Discussion questions.** Why is CTR nonce reuse a confidentiality failure but GCM nonce reuse an integrity failure — and why is the second strictly worse? Why does the nonce need to be unique but not secret and not random? Which of the three §1.6 failure stories would a test suite have caught? Why did the Bitcoin ecosystem fix its RNG problem by removing the RNG?

### 7.3 Unit 3 — The implementation is the algorithm

> **THE ONE IDEA: producing the right output is not correctness. The time your code takes and the addresses it touches are part of its interface, and the compiler will not preserve either.**

This is the unit that earns cryptography its place in a hardware curriculum, and it should be taught with a disassembler open.

**Prerequisites:** Units 1–2, plus the cache and pipeline material from `cpu-architectures.md` and the leak mechanics from `hardware-security.md`.

**Covers:** §6 in full — AES-NI, PCLMULQDQ, ARM crypto extensions, constant-time discipline, what the compiler does to it, bignum and Montgomery multiplication, GPU crypto, secure elements. Plus §3.1–3.6 as the motivation for the bignum material.

**Session shape.** Start with the T-table AES from Unit 1's optimisation instinct — "obviously we should fold the round into a table" — and then show that the fast implementation is the broken one (§2.3). Then AES-NI and the fact that **the constant-time path became the fast path**, which is the happiest sentence in the field. Then constant-time discipline, and the compiler. Then Montgomery, as the example of an algorithm whose whole purpose is to replace a variable-latency operation. Close on §6.4's summary sentence.

**Exercise 3.1 — Constant-time comparison, and the forgery it prevents.**
Write `naive_equal` (early return, like `memcmp`) and `ct_equal` (accumulate with `|=`, then reduce), each instrumented with a work counter that stands in deterministically for elapsed time.
- **Assert** the naive version's work is strictly increasing in the length of the matching prefix — that is the oracle, exhibited.
- **Assert** the constant-time version's work is identical for every input.
- Then run a **byte-at-a-time forgery** that recovers a 16-byte secret tag using only the per-query work measurement plus the accept/reject bit. **Assert it succeeds in at most 16 × 256 = 4096 queries**, against 2^128 for brute force.
- **Assert the same attack fails against `ct_equal`.**

*Verified on Compiler Explorer, September 2026:*
```
naive comparison:  prefix 0..4 bytes match -> work = 1, 2, 3, 4, 5   (the oracle)
constant-time:     prefix 0..4 bytes match -> work = 16 every time
byte-at-a-time forgery against the naive comparison: SUCCEEDED in 4074 queries
  (brute force would need 2^128 = 3.403e+38)
same attack against the constant-time comparison: FAILED (as required)
```

**Exercise 3.2 — Verify it in the emitted assembly.**
Compile fixed-width `naive_equal16`, `ct_equal16` and `ct_select` at `-O2` and read the assembly. **Assert** — programmatically, by grepping the disassembly — that `ct_equal16` and `ct_select` contain **no jump instruction at all**, and that `naive_equal16` contains a data-dependent conditional jump.

This is the exercise that makes §6.4's point land, because the student did not write the branchless code — **the compiler did**, and the compiler could equally have done the opposite.

*Verified on Compiler Explorer (GCC 13.2, `-O2`), September 2026 — the actual emitted code:*
```asm
naive_equal16:                      ct_equal16:
  xor eax, eax                        movdqu xmm1, [rdi]
.L3:                                  movdqu xmm0, [rsi]
  movzx edx, BYTE PTR [rsi+rax]       pxor   xmm0, xmm1
  cmp BYTE PTR [rdi+rax], dl          movdqa xmm1, xmm0
  jne .L4          <-- DATA-DEPENDENT psrldq xmm1, 8
  add rax, 1                          por    xmm0, xmm1
  cmp rax, 16                         ... (three more shift/or folds)
  jne .L3                             movd   eax, xmm0
  mov eax, 1                          movzx  eax, al
  ret                                 sub    eax, 1
.L4:                                  shr    eax, 31
  xor eax, eax                        ret          <-- ZERO jumps, fully SIMD
  ret
```
`ct_select` likewise compiled to six branch-free instructions (`mov / sub / neg / and / and / or`). Note that the constant-time version is also, on this input size, **the faster one** — it is a single 16-byte SIMD compare against a byte loop. That is not usually true, and saying so is the honest version of §6.4's closing point.

**Exercise 3.3 — The `memset` the compiler deletes.**
Write three functions that fill a 32-byte key buffer, pass it to an external function, and then attempt to erase it: one with plain `memset`, one with `memset` plus an inline-asm barrier, one with `volatile` writes. Compile at `-O0` and `-O2`. **Assert** that at `-O0` all three emit the erasure, and that at `-O2` **the plain `memset` is gone entirely** while the other two survive.

*Verified on Compiler Explorer (GCC 13.2), September 2026:*

| Function | `-O0` | `-O2` |
|---|---|---|
| `wipe_naive` (plain `memset`) | `call memset` present | **`call memset` absent — the store was eliminated. The key stays on the stack.** |
| `wipe_barrier` (`memset` + `asm volatile("":::"memory")`) | present | `pxor xmm0,xmm0` + two `movaps` — the zeroing survives |
| `wipe_volatile` (volatile byte writes) | present | an explicit store loop survives |

Nothing about this is a compiler bug. The C abstract machine has no notion of time or of "an attacker later reads this memory", so a store to a dead local is genuinely dead. **This one exercise justifies the existence of `explicit_bzero`, `SecureZeroMemory` and `sodium_memzero` more convincingly than any paragraph.**

**Exercise 3.4 — Modular exponentiation, schoolbook versus Montgomery.**
Implement 64-bit modular exponentiation two ways: schoolbook square-and-multiply with `(a*b) % N` per step, and Montgomery form with `REDC`. Instrument both with counters for multiplies and divisions.
- **Assert** the two produce identical results.
- **Assert** the Montgomery version performs **exactly zero divisions** in the exponentiation loop.
- **Assert** the schoolbook version performs one division per modular multiply.
- Measure wall-clock and **assert** Montgomery is faster.
- Write the final conditional subtraction **branchlessly** (mask-and-select, as in 3.2) and explain what the branch would have leaked.

*Verified on Compiler Explorer, September 2026, with `N = 2^63 − 25` (kept under 2^63 so `T + m·N` stays inside 128 bits — a real implementation constraint worth hitting):*

| | multiplies | divisions |
|---|---|---|
| schoolbook | 110 | **110** |
| Montgomery | 338 | **0** |

```
results agree: PASS
Montgomery performs ZERO divisions in the exponentiation loop.
It trades 110 divisions for 228 extra multiplies (3.07x the multiplies).
schoolbook 100.8 ms   montgomery 76.7 ms   speedup 1.31x   (stable across runs)
```

**Note the honest result, and teach it.** The speedup is **1.3×, not the 2–4× quoted for real RSA.** The reason is a good lesson in itself: at 64-bit width a single 128÷64 reduction is only moderately expensive, so trading one division for two multiplies is a modest win. Montgomery's advantage grows with the number of limbs, because multi-precision *division* scales worse than multi-precision *multiplication*. **Make the student explain the discrepancy rather than hiding it** — a benchmark whose result disagrees with the textbook figure, and a correct explanation of why, is worth more than a benchmark that agrees.

**Exercise 3.5 — Detect and dispatch (optional, machine-dependent).**
Write the `CPUID` checks for AES-NI, PCLMULQDQ and SHA-NI (and the `getauxval(AT_HWCAP)` equivalents for ARM), print what the machine has, and benchmark AES-CTR with and without `-maes`. Compiler Explorer's executor is a shared x86-64 host and **will** report AES-NI, so this exercise is honest about hardware but its *timings* on CE are not reliable — run it locally. The interesting comparison to look for is **serial CBC-encrypt versus 8-way-interleaved CTR** (§6.1), which is a latency-versus-throughput demonstration on a real functional unit, not a cryptographic one.

**Discussion questions.** Why did AES-NI make the *secure* implementation the fast one, and is that the normal state of affairs? What could the compiler do to `ct_equal` that would reintroduce the leak, and how would you find out? Why is Montgomery's conditional subtraction a side channel, and what are the two ways to remove it? Why is a GPU the attacker's tool and not the defender's?

### 7.4 Seminar session — protocols and post-quantum

No exercises; this is reading and argument. §4 and §5 of this document, plus:

- **Read RFC 8446 §7.1** (the TLS 1.3 key schedule) and trace where downgrade protection comes from. The answer — that it is a *consequence* of transcript binding rather than a separate mechanism — is the session's payoff.
- **Read the Signal double-ratchet specification** and identify precisely which step provides post-compromise security and what assumption it needs.
- **Pick a CA incident from §4.4's table** and present it: what failed, what detected it, what changed afterwards.
- **Debate:** "Certificate Transparency is an admission that the CA model cannot be fixed." Argue both sides.
- **Compute your own Mosca inequality** (§5.5) for a system you work on, and decide whether hybrid key exchange is urgent for it.

### 7.5 Notes on the exercise harness

**Backend: Compiler Explorer** (`POST https://godbolt.org/api/compiler/<id>/compile`), which compiles **and runs** C++ and returns the emitted assembly. Everything labelled *Verified on Compiler Explorer* above was executed against that API during this research, on **GCC 13.2 x86-64 (`g132`) with `-O2 -std=c++17`**, in September 2026.

Practical notes for anyone building on it:

- **Inject a unique nonce comment into every submission.** CE caches compile-and-execute results, *including timings*, keyed on the source and options. Without a per-submission nonce you will re-read a cached result and believe you measured something. A `// <uuid>` line as the first line is sufficient.
- The request body wants `options.compilerOptions.executorRequest = true` **and** `options.filters.execute = true` to actually run the binary; leave both off to get assembly instead. `filters.intel = true` gives Intel syntax, which is easier to read in a document.
- **Assertions, not timings, wherever possible.** The correctness exercises (1.1, 1.2, 2.1, 2.2, 3.1, 3.3) are fully deterministic and reproduce exactly. Only 3.4's wall-clock ratio is timing-dependent, and it was stable at 1.30–1.31× across runs — but the *assertion* in that exercise is on the operation counts (`divisions == 0`), which is deterministic, with the timing threshold set generously below the measured value.
- The executor host is shared and has roughly 2 vCPUs. Do not write an exercise that asserts a parallel speedup.
- `assert` failures surface as a `SIGSEGV`/nonzero exit with the assertion text on stderr, so a failing exercise is unambiguous.

---

## Appendix A — Verification ledger: what was checked, what was not

**Research date: September 2026.** This appendix exists because §1.4's argument would be hypocritical without it.

### A.1 Verified by execution during this research

All run against the **Compiler Explorer API**, GCC 13.2 x86-64, `-O2 -std=c++17`, September 2026, each submission carrying a unique nonce comment to defeat result caching. Sources are in the session scratchpad (`ex1_aes.cpp`, `ex2_ctr.cpp`, `ex3_hmac.cpp`, `ex4_mont.cpp`, `ex5_ct_run.cpp`, `ex5_ct_asm.cpp`, `ex6_memset.cpp`, `ce.py`).

| Claim | Result |
|---|---|
| AES-128 implemented from FIPS 197 matches the **Appendix C.1** vector | ✅ `69c4e0d86a7b0430d8cdb78070b4c55a` |
| …matches the **Appendix B** worked example | ✅ `3925841d02dc09fbdc118597196a0b32` |
| The AES S-box generated from `inverse in GF(2^8) + affine map` matches the standard table at `0x00`, `0x53`, `0xff` | ✅ |
| ECB gives identical ciphertext for identical plaintext blocks; CBC does not | ✅ |
| CTR nonce reuse ⟹ `C₁⊕C₂ == P₁⊕P₂` exactly; full known-plaintext recovery; crib-drag recovery | ✅ |
| A distinct nonce destroys the relation (0 of 68 bytes match) | ✅ |
| SHA-256 matches the FIPS 180-4 `"abc"` vector | ✅ |
| HMAC-SHA-256 matches **RFC 4231** test cases 1, 2, 3, 4, 6, 7 | ✅ all six |
| `SHA-256(key‖msg) ≠ HMAC(key,msg)` | ✅ |
| Montgomery modexp agrees with schoolbook modexp | ✅ |
| Montgomery performs **0** divisions vs schoolbook's 110, at 3.07× the multiplies | ✅ |
| Montgomery is faster in wall-clock at 64-bit width | ✅ **1.30–1.31×**, stable across three runs |
| Early-exit comparison leaks the matching prefix length; constant-time does not | ✅ work = 1,2,3,4,5 vs 16,16,16,16,16 |
| Byte-at-a-time tag forgery against early-exit comparison | ✅ **4074 queries** (bound 4096) vs 2^128 |
| The same attack against constant-time comparison | ✅ fails, as required |
| GCC `-O2` compiles `ct_equal16` and `ct_select` to code with **zero jump instructions**; `naive_equal16` retains a data-dependent `jne` | ✅ assembly inspected and reproduced in §7.3 |
| GCC `-O2` **deletes** a plain trailing `memset` on a dead local; an asm barrier or `volatile` writes preserve it; `-O0` preserves all three | ✅ |

### A.2 Verified against a primary or authoritative source, fetched during this research

| Claim | Source |
|---|---|
| FIPS 203 (ML-KEM), 204 (ML-DSA), 205 (SLH-DSA) are final, released August 2024 | csrc.nist.gov/projects/post-quantum-cryptography |
| HQC announced as a 4th-round KEM selection in 2025 | csrc.nist.gov, same page |
| FALCON/FN-DSA (FIPS 206) still in draft, final expected late 2026 / early 2027 | NIST PQC project page + Wikipedia cross-check |
| NIST IR 8547: quantum-vulnerable algorithms deprecated after 2030, removed by 2035 | NIST PQC project page |
| **X25519MLKEM768 = TLS supported-group codepoint 4588 (0x11EC)** | IANA TLS Parameters registry, fetched Sept 2026 |
| SecP256r1MLKEM768 = 4587 | IANA TLS Parameters registry |
| X25519Kyber768Draft00 = 25497 (0x6399), marked **OBSOLETE** as a pre-standard Kyber, obsoleted by RFC 10024 | IANA TLS Parameters registry |
| Post-quantum key agreement was ≈2% of TLS 1.3 connections to Cloudflare in early 2024, >99% of it from Chrome | blog.cloudflare.com/pq-2024 |
| `getrandom(2)` semantics: urandom source by default, blocks only until pool initialisation, ≤256-byte requests are not interrupted by signals, `GRND_RANDOM` selects legacy behaviour | man7.org `getrandom(2)` (fetched for §1.6 earlier in this research) |

### A.3 Stated from established literature but not re-verified against the primary source here

These are well-attested and cited with author and venue in the text, but the papers themselves were not fetched during this research: Vaudenay (EUROCRYPT 2002), AlFardan & Paterson Lucky 13 (2013), Bleichenbacher (CRYPTO 1998), Böck et al. ROBOT (2017) and Nonce-Disrespecting Adversaries (WOOT 2016), Heninger et al. Mining Your Ps and Qs (USENIX 2012), Adrian et al. Logjam (CCS 2015), Bhargavan & Leurent Sweet32 (CCS 2016), Osvik–Shamir–Tromer (2006), Bernstein's 2005 AES cache-timing note, Boneh–Venkatesan HNP (CRYPTO 1996), Castryck–Decru SIKE break (2022), Chalkias et al. "Taming the many EdDSAs" (2020), Gidney–Ekerå (2019) and Roetteler et al. (2017) quantum resource estimates, Kaufmann et al. "When Constant-Time Source Yields Variable-Time Binary" (2016), Beurdouche et al. "A Messy State of the Union" (IEEE S&P 2015), Percival's scrypt paper (2009), Provos & Mazières bcrypt (USENIX 1999), Montgomery (Math. Comp. 1985), Shannon (1949).

### A.4 What I could NOT verify — the explicit list, with dates

Every item here is marked in the text where it appears. All statuses are **as of September 2026**.

1. **The current default of Linux's `random.trust_cpu` boot parameter on 2026 kernels.** The policy has changed more than once and I did not confirm the present default. *(§1.6)*
2. **That `/dev/random` stopped blocking on entropy estimates in Linux 5.6** — well documented in changelogs and Donenfeld's write-ups, but the man page fetched during this research did not itself state it. *(§1.6)*
3. **OWASP's current Argon2id parameter floor.** The `m=19 MiB, t=2, p=1` figure reflects the Password Storage Cheat Sheet as of the last version I have; late-2026 revisions were not checked. RFC 9106's own recommendations (t=1/m=2 GiB/p=4 and t=3/m=64 MiB/p=4) are from the RFC and are stable. *(§2.12)*
4. **NIST SP 800-63B Revision 4's exact final wording** on password composition, length and rotation. The substance has been stable since Rev. 3 (2017); the Rev. 4 text was not fetched. *(§4.5)*
5. **The CA/Browser Forum's adopted certificate-lifetime ratchet schedule.** The direction (toward ~47 days by 2029) is well reported, but the exact milestone dates were still being phased in and were not verified against a ballot. *(§4.4)*
6. **FIPS 206 (FN-DSA/FALCON) and HQC final publication dates.** Both are stated as expectations ("late 2026 / early 2027", "2027") and are explicitly not confirmed. *(§5.3)*
7. **The status and any 2026 selections from NIST's "additional signatures" onramp round.** Not checked. *(§5.3)*
8. **Cloudflare's current post-quantum adoption percentage.** The ~2% figure is from early 2024 and is certainly stale; the live number is on Cloudflare Radar and was not fetched. *(§5.4)*
9. **Exact Chrome and Firefox version numbers** for the X25519MLKEM768 default switch (given as Chrome 131 / Firefox 132–135). The IANA codepoint and the fact of the migration are verified; the specific version numbers are from memory of release notes and were not confirmed. *(§5.4)*
10. **All cycles-per-byte performance figures in §6.1 and §6.2**, and the Ed25519 and RSA operation timings in §3.8 and §4.6. These are order-of-magnitude figures from published benchmarks and general knowledge; **none were measured during this research** and they vary by more than 2× across microarchitectures. Treat every one as "the right power of ten", not as a number. *(§3.8, §4.6, §6.1, §6.2)*
11. **`AESENC` latency and reciprocal throughput** on specific Skylake-and-later parts (given as ~4 and ~1). Not verified against Agner Fog's tables or `uops.info` during this research. *(§6.1)*
12. **Which specific ARM cores macro-fuse `AESE`/`AESMC`.** The fusion is a documented optimisation on several cores; I did not verify a per-core list. The Raspberry Pi 4 (Cortex-A72) lacking the crypto extensions, and the Pi 5 (Cortex-A76) having them, is stated with reasonable confidence but was not re-checked. *(§6.3)*
13. **The exact set of validation checks FIPS 186-5 mandates for Ed25519 verification.** Flagged in the text; the standard was not fetched. *(§3.8)*
14. **The precise loss figure for the 2013 Android/Bitcoin nonce reuse incident.** Given as "a few tens of BTC", which is a widely repeated range rather than an audited number. *(§1.6)*
15. **Exercise 3.5** (CPUID dispatch and AES-NI benchmarking) is the one exercise in §7 that was **not run**, because Compiler Explorer's shared executor makes its timings meaningless. Its assertions are design sketches, not verified results. *(§7.3)*

### A.5 A note on what "verified" means here

Every ✅ in A.1 means *a program was compiled and executed and its assertions passed*. That is exactly the standard §1.4 says is insufficient for security, and it is worth being explicit: **these verifications establish that the exercises work as teaching artefacts. They do not establish that any code in this document is safe to deploy.** That is the whole point of §1.4, and it applies to this document's own code as much as to anyone else's.

---

## Appendix B — Reading, ranked

**Start here, in this order:**

1. **FIPS 197** (AES) — twelve pages, free, complete, with worked examples. The single best specification-to-implementation exercise in computing.
2. **RFC 8439** (ChaCha20-Poly1305) — a modern AEAD specified clearly enough to implement in an afternoon, with test vectors.
3. **Cryptopals** (cryptopals.com) — the challenge set. Sets 1 and 2 alone (ECB detection, byte-at-a-time ECB decryption, CBC bit-flipping, padding oracles) teach §2 better than any textbook. Free, no answers, and the difficulty curve is well judged.
4. **Aumasson, *Serious Cryptography*, 2nd ed. (2024)** — the right first book for a working engineer. Practical, current, honest about what breaks.

**Then, by topic:**

- **Protocols:** RFC 8446 (TLS 1.3) — read §7.1 (key schedule) and Appendix E (the security analysis) even if you skip the message flow. The Signal Double Ratchet and X3DH specifications (signal.org/docs) are short and unusually well written.
- **Post-quantum:** FIPS 203/204/205 themselves; NIST IR 8547 for the migration timeline; the Cloudflare research blog for what is actually deployed.
- **Implementation and hardware:** **BearSSL's source and documentation** (bearssl.org) — Pornin's design notes on constant-time programming are the best free writing on the subject. **libsodium's documentation** for the misuse-resistant-API argument. Intel's *"Carry-Less Multiplication and Its Usage for Computing the GCM Mode"* white paper for §6.2. Bernstein's Curve25519 and Ed25519 papers for §3.6 and §3.8, both of which are readable and explicitly argue their design decisions.
- **Theory, when you want it:** Katz & Lindell, *Introduction to Modern Cryptography* — the standard rigorous textbook, definition-and-proof driven. Boneh & Shoup, *A Graduate Course in Applied Cryptography* — free online, more applied than Katz–Lindell, excellent on the gap between primitive and protocol.
- **The attacks, as primary sources:** Vaudenay 2002 (padding oracles), Bleichenbacher 1998, ROBOT 2017 (read alongside Bleichenbacher to see the nineteen-year gap), Heninger et al. 2012 (Ps and Qs), Böck et al. 2016 (nonce-disrespecting adversaries), Castryck–Decru 2022 (the SIKE break, and how quickly a well-regarded scheme can fall).
- **For the curriculum's own sake:** fail0verflow, *"Console Hacking 2010"* (27C3) — the PS3 ECDSA talk. It is on video, it is forty minutes, and it is the single most effective way to make §2 and §3's nonce material land.

**Deliberately not recommended:** any tutorial that shows you how to encrypt a string with AES-ECB because it is the one that does not need an IV; any Stack Overflow answer containing `AES/ECB/PKCS5Padding`; and any blog post that explains RSA without mentioning padding.

