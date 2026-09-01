# Information Theory, Compression, and Error-Correcting Codes

Research notes for a from-first-principles computing curriculum. This is the shared substrate
that the **storage** and **networking** tracks both stand on and neither currently explains.

Storage needs it because a filesystem is a compression scheme with a checksum stapled to it, an
SSD is an LDPC decoder with some flash cells attached, and an object store is Reed–Solomon
arithmetic wearing a REST API. Networking needs it because every frame ends in a CRC, every
modem is a channel-capacity argument made concrete, and TCP's whole existence is an admission
that the channel is noisy. And the AI track needs it because **cross-entropy loss is a
compression bound**, and because a silent bit flip in HBM on hour 300 of a 10,000-GPU run is a
real operational problem with a real coding-theory answer.

The claim of this document is that these are one subject with three faces:

- **Compression** removes redundancy the source put there by accident.
- **Error-correcting codes** add redundancy back, on purpose, in a shape the channel cannot destroy.
- **Hashing** compresses to a fixed size while destroying structure deliberately.

Shannon proved in 1948 that the first two are independent problems — you can do them separately
and lose nothing. That single result, the *separation theorem*, is why every system you will ever
build has a compressor and a codec as different boxes.

---

## Provenance

**Executed live during this research.** Every numeric claim marked *(verified)* below was
compiled and *run* against the Compiler Explorer execution API
(`https://godbolt.org/api/compiler/g152/compile`, GCC 15.2, `executorRequest: true`), several with
zlib 1.3.1 linked in. The full programs and their real output are in §7. Nothing in §7 is
transcribed from memory; it is transcribed from stdout.

**Discovered, not assumed:** Compiler Explorer's C++ executor *has zlib available as a library*
(`zlib 1.3.1`). That single fact unlocks the best exercise in the whole unit — measure a text's
entropy, then measure what DEFLATE actually achieves on it, in the same process, and explain the
gap in both directions. It goes both ways: DEFLATE beats the order-0 entropy on English and
*loses* to it on random letters. Both surprises are the lesson.

**A piece of folklore corrected by computation.** It is widely repeated that CRC-32 (the Ethernet
one) detects all odd-weight error patterns because its generator polynomial is divisible by
`(x+1)`. **This is false**, and §7.2 proves it in four lines of arithmetic: `0x04C11DB7` plus the
implicit `x³²` has *fifteen* nonzero terms, so `G(1) = 1`, so `(x+1) ∤ G`. It is instead a
*primitive* polynomial of degree 32 — the multiplicative order of `x` modulo it is exactly
`2³²−1 = 4294967295` (verified). CRC-32**C** (Castagnoli) is the one with the `(x+1)` factor.
This matters, and the curriculum should teach the check, not the folklore.

**Fetched from primary sources.** RFC 1951 (DEFLATE), RFC 7932 (Brotli), the Zstandard README's
benchmark table, arXiv:1311.2540 (Duda, ANS), arXiv:2407.21783 (Llama 3, §3.3.4 reliability),
Google's DRAM field study, arXiv:2102.11245 (Meta, silent data corruptions), VUSec's ECCploit
page, `docs.kernel.org` EDAC, the BLAKE3 and xxHash READMEs. Links in §9.

**Flagged as unverified.** §8 lists what could not be checked, what is recalled rather than
sourced, and what will go stale.

---

# 1. Information Theory — the working subset

## 1.1 Surprise, and why it has to be a logarithm

Start with a single event, not a distribution. You are told something. How much did you learn?

Whatever "amount learned" means, it has to satisfy three things:

1. **Learning something certain teaches nothing.** If `p = 1`, the information is 0.
2. **Rarer is more informative.** If `p` goes down, information goes up.
3. **Independent facts add.** If you learn two unrelated things, the total is the sum.

Requirement 3 is the one with teeth. Independent events multiply probabilities
(`p(A,B) = p(A)·p(B)`) but must add information (`I(A,B) = I(A) + I(B)`). The only continuous
function turning multiplication into addition is the logarithm. So

```
    I(x) = -log p(x)          "surprisal", or "self-information"
```

and the base of the log is just a choice of unit:

| base | unit | why you'd use it |
|---|---|---|
| 2 | **bit** (binary digit) | everything in computing |
| e | **nat** | everything in ML, because `log` in code means `ln` |
| 10 | ban / hartley | Bletchley Park, historically |

`1 nat = 1/ln 2 = 1.4427 bits`. Keep that number. It is the entire difference between a PyTorch
loss curve and a compression ratio, and §1.6 is going to need it.

## 1.2 Entropy is expected surprise

Now take the whole distribution. **Shannon entropy** is the average surprisal:

```
    H(X) = - Σ  p(x) log₂ p(x)      bits per symbol
             x
```

with the convention `0 log 0 = 0` (an impossible symbol contributes nothing).

Three readings of the same formula, all worth having:

- **Average surprise.** How astonished you are per draw, on average.
- **Average uncertainty.** How much you don't know before the draw.
- **Expected code length.** The average number of bits needed per symbol by the best possible
  code. This is the reading that makes it engineering rather than philosophy, and §1.4 makes it
  a theorem.

### Worked examples

**Fair coin.** `p(H) = p(T) = 1/2`. `H = -2 · (½ log₂ ½) = 1 bit`. One bit per flip. This is the
definition of the unit: one bit is exactly the uncertainty of a fair coin.

**Biased coin, `p = 0.9`.** `H = -(0.9 log₂ 0.9 + 0.1 log₂ 0.1) = 0.4690 bits`.
Less than half a bit — you already mostly know the answer. Note what this does to Huffman coding:
there are two symbols, so any prefix code must spend *at least* 1 bit on each. Huffman is
**113% over the entropy** on this source (verified, §7.3). That gap is the entire reason
arithmetic coding exists.

**Fair die.** `H = log₂ 6 = 2.585 bits`. Not an integer. You cannot spend 2.585 bits on one roll,
but you *can* spend 2585 bits on 1000 rolls, and that is the whole idea of block coding.

**Uniform over `n` symbols.** `H = log₂ n`, and this is the maximum possible for an `n`-symbol
alphabet. Entropy is maximised by ignorance.

**Deterministic source.** `H = 0`. A file of a million zeros carries no information about
anything (though see §1.7 — its *Kolmogorov* complexity is not zero, it is about the length of
the program `for i in range(10**6): print(0)`).

**Real English text** *(verified, §7.1)*: over a passage of Austen, the order-0 (per-character)
entropy measured **4.130 bits/char**. Conditioning on the previous character drops the measured
value to **2.820 bits/char**. Both numbers are *estimates from a finite sample*, and the second
one is optimistic — the plug-in entropy estimator is biased downward, badly so when you have 29
symbols and only a few thousand bigram observations. Shannon's own 1951 estimates for printed
English are roughly `F₀ ≈ 4.76` (27 symbols, uniform), `F₁ ≈ 4.03`, `F₂ ≈ 3.32`, `F₃ ≈ 3.1`, and
his human-prediction gambling experiment put the true entropy of English at **0.6–1.3 bits per
character** once arbitrarily long context is allowed. *(These 1951 figures are recalled, not
re-verified here — see §8.)*

That last range is the single most important number in this document for an AI audience. It says:
a perfect model of English needs about **1 bit per character**. A GPT-class model's cross-entropy
loss, converted to bits per character, is *directly comparable to it*. §1.6.

### The shape of `H(p)` for a binary source

```
 H(p) bits
  1.0 |            .----.----.
      |        .---'          '---.
  0.8 |     .-'                    '-.
      |   .'                          '.
  0.6 |  /                              \
      | /                                \
  0.4 |/                                  \
      |                                    \
  0.2 |                                     \
      |                                      \
  0.0 +---+---+---+---+---+---+---+---+---+---+
      0  .1  .2  .3  .4  .5  .6  .7  .8  .9  1.0   p
```

Flat on top, plunging at the ends. Two consequences you will meet constantly:

- Near `p = 0.5`, entropy is *insensitive* to getting `p` slightly wrong. A model that is
  poorly calibrated in the middle of the range loses very little.
- Near `p = 0` or `p = 1`, entropy is *extremely* sensitive. This is why a language model's loss
  is dominated by the rare, confident predictions, and why a single badly-calibrated
  high-confidence error costs enormous loss. It is also why `log(0)` blows up your training run.

## 1.3 The units trap, stated once so it never bites again

Every entropy-adjacent quantity has a unit, and mixing them is the most common error in this
whole area:

| quantity | typical unit | conversion |
|---|---|---|
| entropy `H(X)` | bits/symbol | — |
| cross-entropy loss (PyTorch) | **nats**/token | `bits = nats / ln 2 = nats × 1.4427` |
| perplexity | dimensionless | `PPL = e^(nats) = 2^(bits)` |
| compression ratio | dimensionless | `original / compressed` |
| "bits per byte" (BPB) | bits/byte | `bits_per_token × tokens / bytes` |

A model reporting loss `2.0` (nats/token) has cross-entropy `2.0 × 1.4427 = 2.885` bits/token and
perplexity `e² = 7.39`. If its tokenizer averages 4 bytes/token, that is `0.72` bits/byte, which
would compress plain text to about 9% of its size — far better than gzip. That arithmetic is the
whole of §1.6 and the whole justification for the "LLMs are compressors" literature.

## 1.4 The source coding theorem — why entropy is a hard floor

**Shannon's source coding theorem (1948).** Let a source emit i.i.d. symbols from a distribution
with entropy `H(X)` bits/symbol. Then:

1. For any `ε > 0`, there is a lossless code with average length `L < H(X) + ε` bits/symbol.
2. **No** lossless code has average length `L < H(X)`. Ever. Not with a cleverer algorithm, not
   with more compute, not with a better model.

Part 2 is the one that matters, and it does not need heavy machinery to believe.

### The counting argument (this is the whole proof, informally)

There are `2ⁿ` possible `n`-bit strings. A lossless code is an *injection* from messages to
bitstrings — if two messages mapped to the same code, decoding would be ambiguous. So a code that
maps `N` distinct messages into `n`-bit outputs requires `2ⁿ ≥ N`, i.e. `n ≥ log₂ N`.

Now the probabilistic version. By the **asymptotic equipartition property (AEP)**, for large `n`
the probability mass of an i.i.d. source concentrates on a "typical set" of about `2^(nH)`
sequences, each with probability about `2^(-nH)`. Everything else has vanishing total
probability. So you need to index `2^(nH)` things, which takes `nH` bits, which is `H` bits per
symbol. Fewer bits means fewer codewords than typical sequences, which means collisions, which
means loss.

### The pigeonhole corollary: no compressor compresses everything

A one-line consequence people find shocking and shouldn't: **no lossless compressor can shrink
every input.** If it maps every 1000-bit string to something shorter, it maps `2¹⁰⁰⁰` inputs into
`2¹⁰⁰⁰ − 1` shorter strings, so two collide, so it is not lossless. Every real compressor makes
*some* inputs bigger. gzip's worst case is +0.03% plus a small header; that expansion is not a
bug, it is a theorem.

This is also the correct rebuttal to every "infinite compression" scam. There have been many.

### The gap between theory and practice, both directions

The floor is `H(X)` **for the model you are using**. That qualifier does all the work, and the
exercise in §7.1 makes it visible in both directions *(verified)*:

```
                          n     H₀ (bit/sym)   order-0 floor   zlib -6 achieves
repetitive text          9000      4.397           4946 B          96 B
english × 20             7520      4.130           3882 B         286 B
pseudo-random letters    9000      4.697           5285 B        5628 B
```

- On the first two, **DEFLATE crushes the order-0 "floor" by 13–50×**. There is no contradiction:
  the theorem bounds a *memoryless* source, and English is not memoryless. LZ77 is exploiting
  structure the order-0 model cannot see. When someone says "entropy is a hard floor", the
  correct completion is "*of the source model you assumed*."
- On the third, **DEFLATE loses to the order-0 floor** — 5628 bytes against a 5285-byte floor,
  5.003 bits/symbol against 4.697. The letters are uniform-ish and independent, LZ77 finds
  nothing, and Huffman's integer code lengths plus block headers cost more than they save. This
  is the honest picture: a compressor is a bet on structure, and losing bets cost you.

## 1.5 Joint, conditional, and the chain rule

**Joint entropy** — the uncertainty of a pair:

```
    H(X,Y) = - Σ  p(x,y) log₂ p(x,y)
```

**Conditional entropy** — the uncertainty left in `Y` once you know `X`:

```
    H(Y|X) = - Σ  p(x,y) log₂ p(y|x)   =   H(X,Y) − H(X)
```

Read the second form as: *the extra bits `Y` costs you once you've already paid for `X`.* That
identity is the **chain rule**, and it generalises:

```
    H(X₁,…,Xₙ) = H(X₁) + H(X₂|X₁) + H(X₃|X₁,X₂) + …
```

**This is exactly what an autoregressive language model computes.** A transformer's loss is
`−log p(xₜ | x₁…xₜ₋₁)` summed over `t`. The chain rule of entropy *is* the chain rule of
probability *is* the training objective. When people say "next-token prediction is enough", the
chain rule is the reason it is not obviously wrong: any joint distribution factorises this way
exactly, with no approximation.

Key facts, each worth a minute:

- `H(Y|X) ≤ H(Y)`. **Conditioning never hurts.** Extra context can only reduce uncertainty, on
  average. Note *on average* — a specific observation can absolutely increase your surprise.
- `H(Y|X) = H(Y)` iff `X` and `Y` are independent.
- `H(Y|X) = 0` iff `Y` is a deterministic function of `X`.
- The measured drop from 4.130 to 2.820 bits/char in §7.1 is exactly `H(X) → H(X|X_prev)`
  on real text *(verified)*.

## 1.6 Mutual information, KL divergence, and the cross-entropy connection

### Mutual information

```
    I(X;Y) = H(X) − H(X|Y) = H(Y) − H(Y|X) = H(X) + H(Y) − H(X,Y)
```

*How many bits knowing `Y` saves you about `X`.* It is symmetric, non-negative, and zero exactly
when `X ⊥ Y`. Drawn as a Venn diagram:

```
        .-----------------.
       /                   \
      /       H(X)          \
     /      .---------------.-------------.
    |      /                 \             \
    |     /   H(X|Y)   .------.   H(Y|X)    \
    |     |            |I(X;Y)|              |
    |     \            '------'             /
     \     \                 /             /
      \     '---------------'-------------'
       \                          H(Y)   /
        '------------------------------'
```

`I(X;Y)` is the overlap. `H(X,Y)` is the whole union. This picture is exactly right for two
variables and starts lying for three, so use it and then stop.

Where you meet it: feature selection, the information bottleneck view of deep learning,
decision-tree splits (information gain *is* mutual information), and — most concretely — channel
capacity in §1.8, which is `max I(input; output)` over input distributions.

### KL divergence

```
    D_KL(p ‖ q) = Σ p(x) log₂ ( p(x) / q(x) )       bits
```

**The extra bits you pay per symbol for coding a `p`-distributed source with a code built for
`q`.** That is not an analogy. It is the operational meaning, and it is the reason the quantity
exists at all.

Properties:
- `D_KL(p ‖ q) ≥ 0`, with equality iff `p = q` almost everywhere (Gibbs' inequality).
- **Not symmetric.** `D_KL(p‖q) ≠ D_KL(q‖p)`. Not a metric. The asymmetry is meaningful:
  `D_KL(p‖q)` (forward, "mean-seeking") punishes `q` for putting *zero* mass where `p` has mass;
  `D_KL(q‖p)` (reverse, "mode-seeking") punishes `q` for putting mass where `p` has none. Variational
  inference uses reverse KL and gets mode collapse; maximum likelihood uses forward KL and gets
  blurry averages. That is the same trade-off in two costumes.
- **Infinite when `q(x) = 0` and `p(x) > 0`.** Your model assigned probability zero to something
  that happened. You pay infinity bits, because you can't encode it at all. In practice: `NaN`.
  This is why softmax outputs and label smoothing and `eps` exist.

### ★ Cross-entropy loss *is* this. Exactly, not approximately.

Define **cross-entropy**:

```
    H(p, q) = - Σ p(x) log₂ q(x)
```

and the fundamental decomposition:

```
    H(p, q)  =  H(p)  +  D_KL(p ‖ q)
    ───────     ────     ───────────
    what you    what     what your model's
    actually    the      wrongness costs
    pay         data     you, on top
                costs
                (irreducible)
```

Now look at what a classifier or a language model actually optimises. For a training set
`x₁…x_N` with a model `q_θ`:

```
    L(θ) = - (1/N) Σ log q_θ(xᵢ)
```

The empirical distribution `p̂` puts mass `1/N` on each observed sample, so
`L(θ) = H(p̂, q_θ)` — **the loss is literally the cross-entropy between the data distribution and
the model** (in nats, because `log` in every framework means `ln`). And since `H(p̂)` does not
depend on `θ`:

```
    argmin_θ  cross-entropy  =  argmin_θ  D_KL(p̂ ‖ q_θ)  =  argmax_θ  likelihood
```

Three names, one operation. Minimising cross-entropy, minimising KL divergence from the data,
and maximum likelihood estimation are the *same computation*, and this is not a coincidence to
be memorised — it is the decomposition above, read three ways.

**Now the part that closes the loop with the rest of this document.** Cross-entropy has an
operational meaning in bits: `H(p̂, q_θ)` bits/symbol is *exactly the average code length you
would achieve* if you fed `q_θ` to an arithmetic coder (§2.3) and encoded the dataset. So:

> **A model's cross-entropy loss is a compression ratio.**
> Loss in bits/token, times tokens, is the size of the file.

This is not a metaphor and it is not hand-waving; it is what §2.3 verifies numerically — the
arithmetic coder in §7.4 hit **0.47315 bits/symbol on a source with entropy 0.47315 bits/symbol**,
agreeing to five decimal places. If your model is the probability model, the coder achieves your
cross-entropy. Full stop.

Consequences worth putting in front of an AI-track student explicitly:

1. **`H(p)` is the irreducible floor.** No model, however large, gets loss below the entropy of
   the data. When a scaling-law curve flattens, that is (in part) the model approaching `H(p)`.
   The "irreducible loss" term in Chinchilla-style scaling laws `L = E + A/Nᵃ + B/Dᵇ` — that `E`
   is `H(p)`, the entropy of natural language. It is a Shannon quantity in a deep-learning paper.
2. **Perplexity is exponentiated cross-entropy.** `PPL = 2^H(p,q)` (bits) `= e^L` (nats). A
   perplexity of 20 means the model is as uncertain as if choosing uniformly among 20 options.
3. **Better model ⇔ better compressor, identically.** The Hutter Prize has paid out for compressing
   Wikipedia since 2006 on exactly this basis. And it runs the other way: DeepMind's
   *Language Modeling Is Compression* (Delétang et al., 2023) used a frozen Chinchilla-70B as the
   probability model for an arithmetic coder and beat domain-specific codecs on their own
   territory — image data below PNG, audio below FLAC. *(Numbers recalled; see §8.)*
4. **Distillation is KL.** Student-teacher distillation minimises `D_KL(teacher ‖ student)` over
   the soft label distribution. RLHF's KL penalty keeps the policy near the reference model in
   exactly these units. `β·KL` in a DPO or PPO objective is a *bit budget*.
5. **`log(0) = −∞` is the same fact as "your code can't encode that symbol".** Numerical stability
   tricks (log-sum-exp, label smoothing, clamping) are all "make sure `q` never assigns zero".

Have the student compute this once, by hand, on a toy vocabulary. The identity
`H(p,q) = H(p) + D_KL(p‖q)` becomes permanent the moment they've plugged in five numbers.

## 1.7 Kolmogorov complexity, and why it is uncomputable

Shannon entropy is a property of a *distribution*. But what is the information content of a single
object — this specific 1 MB file — with no distribution in sight?

**Kolmogorov complexity** `K(x)` is the length of the shortest program (on a fixed universal
Turing machine) that outputs `x` and halts.

- `K("0" × 10⁶)` is small: a short loop.
- `K(first 10⁶ digits of π)` is small: a spigot algorithm is a few hundred bytes.
- `K(10⁶ fair coin flips)` is about `10⁶` bits: almost certainly nothing shorter than the string
  itself exists.

The **invariance theorem** says the choice of universal machine only changes `K` by an additive
constant (the length of an interpreter for one language written in another), so `K` is
well-defined up to `O(1)`.

The connection to Shannon: for a computable source `p`, the expected Kolmogorov complexity equals
the entropy up to a constant, `E_p[K(x)] = H(p) + O(1)`. Algorithmic and probabilistic information
agree in expectation. They disagree pointwise, and the pointwise version is what makes π
compressible despite being (statistically) indistinguishable from random.

### Why it is uncomputable

Suppose `K` were computable. Then consider this program:

```
    # "Berry's paradox", mechanised
    for candidate in all_strings_in_length_order():
        if K(candidate) > 10**9:
            print(candidate)
            break
```

This program is a few hundred bytes long. It prints a string whose Kolmogorov complexity is
provably greater than 10⁹ bits. But the program *is* a description of that string, of length a few
hundred bytes — so the string's complexity is at most a few hundred bytes. Contradiction. Therefore
`K` is not computable.

Equivalently, by reduction to the halting problem: if you could compute `K` you could decide
halting, and you cannot.

**Chaitin's incompleteness theorem** sharpens the sting: for any consistent formal system with a
finite axiomatisation, there is a constant `L` such that the system can never prove
`K(x) > L` for *any* specific `x`. There are infinitely many random strings, and you can prove
almost none of them are random.

### Why it belongs in this curriculum anyway

Because it is the correct answer to "what is the best possible compression of *this file*", and
because it makes the boundary of the whole field visible: **every compressor is a computable
approximation to an uncomputable ideal.** gzip approximates `K` with "LZ77 + Huffman". A
transformer approximates `K` with 70 billion parameters. Neither reaches it, and no one ever will,
and that is a theorem rather than an engineering shortfall.

It also explains why compression benchmarks are a legitimate proxy for intelligence
(Solomonoff induction, AIXI, the Hutter Prize) and simultaneously why they can never be a complete
one.

## 1.8 Channels, capacity, and the channel coding theorem

Flip the problem. The source coding theorem removes redundancy. Channel coding *adds* it, because
the channel is noisy.

### The channel model

A discrete memoryless channel is a conditional distribution `p(y|x)`: you put in `x`, the channel
gives you `y`, independently each use.

**Binary symmetric channel (BSC(p)):** each bit flips independently with probability `p`.
```
        1-p
    0 ------> 0
      \  p  /
       \   /
        \ /
        / \
       /   \
      /  p  \
    1 ------> 1
        1-p
```

**Binary erasure channel (BEC(ε)):** each bit is either delivered perfectly or replaced with `?`,
with probability `ε`. You always know *which* bits were lost. This is the right model for packet
networks (a packet either arrives with a valid checksum or does not arrive at all) and for
disk/node failures in a storage cluster — and it is why §4.5's erasure codes are the storage
world's tool of choice.

### Capacity

```
    C = max  I(X;Y)          bits per channel use
       p(x)
```

The most information you can push through, maximised over what you're allowed to choose (the
input distribution). Worked out:

| channel | capacity | sanity check |
|---|---|---|
| BSC(p) | `C = 1 − H(p)` | `p=0 → C=1`; `p=0.5 → C=0`; `p=1 → C=1` (invert everything!) |
| BEC(ε) | `C = 1 − ε` | you lose exactly the erased fraction |
| AWGN, bandwidth `B` | `C = B log₂(1 + S/N)` | **Shannon–Hartley** |

The `p = 0.5` case of the BSC is worth dwelling on: a channel that flips half the bits at random
has capacity **zero**. Output is independent of input. And `p = 1` has capacity **one** — a channel
that flips *every* bit is a perfect channel with a relabelling. Noise is only harmful when it is
uncertain.

**Shannon–Hartley** is the formula behind every "why is my Wi-Fi slow" answer: capacity is linear
in bandwidth and only logarithmic in power. Doubling transmit power buys you one extra bit per
symbol. Doubling bandwidth doubles the rate. This is why 5G chases millimetre-wave spectrum
instead of bigger amplifiers, why Wi-Fi 6E/7 went to 6 GHz for the 320 MHz channels, and why
NVLink and PCIe gain generations by clocking faster and adding lanes rather than shouting louder.

### The channel coding theorem (1948)

> For any rate `R < C`, there exist codes of increasing block length whose probability of decoding
> error goes to **zero**. For any `R > C`, the error probability is bounded away from zero.

This was, at the time, staggering. The intuition before Shannon was that reliability had to be
bought with rate — send everything three times to get fewer errors, and accept a third of the
throughput. Shannon proved that you can have arbitrarily reliable communication at *any* rate
below capacity, and the price is **latency and block length**, not rate.

The proof is non-constructive and outrageous: pick a codebook *at random*, show the average random
codebook works, conclude a good one exists. It gave engineers a target and no way to hit it. The
next fifty years of coding theory were the search for constructive codes approaching `C` — and
they were found: turbo codes in 1993, and LDPC codes, invented by Gallager in 1962 and then
*forgotten for thirty years* because the computers of 1962 could not run the decoder (§4.6).

Two more numbers worth carrying:

- The **Shannon limit** for the AWGN channel as rate → 0 is `Eb/N₀ = ln 2 = −1.59 dB`. Below that
  energy-per-bit, no code works, ever. Modern LDPC codes get within a few tenths of a dB.
- **Block length is the currency.** Approaching capacity requires long blocks. This is why 5G
  data channels use LDPC blocks of thousands of bits while its *control* channels use short polar
  codes — control needs low latency more than it needs capacity.

### The separation theorem — the reason systems look the way they do

Shannon also proved that for a point-to-point channel you lose nothing by doing source coding and
channel coding **separately**: compress to `H` bits, then protect those bits with a rate-`R < C`
channel code. A jointly-designed scheme cannot beat it asymptotically.

This is why your stack has a `gzip` and a `CRC` and they know nothing about each other. It is why
`Content-Encoding: gzip` and TLS's MAC and Ethernet's FCS are three unrelated boxes. It is a
theorem that became an architecture.

(Caveat, since a good student will ask: separation is asymptotic and point-to-point. For finite
block lengths, broadcast channels, or multi-user settings it can fail, which is why joint
source-channel coding exists in research and in some satellite/video-streaming systems. But for
everything in this curriculum, separation holds and explains the design.)

## 1.9 The two theorems, side by side

| | source coding | channel coding |
|---|---|---|
| goal | remove redundancy | add redundancy |
| limit | entropy `H(X)` | capacity `C` |
| direction | can't go **below** `H` | can't go **above** `C` |
| cost of approaching | model complexity, memory | block length, latency, decode compute |
| you meet it as | gzip, zstd, JPEG, an LLM's loss | CRC, Reed–Solomon, LDPC, ECC RAM |
| year proved | 1948 | 1948 |
| practical codes | 1952 (Huffman) | 1993/2003 (turbo, LDPC rediscovery) |

The 45-year gap in that last row is the story of coding theory.

---

# 2. Lossless Compression

## 2.0 The one decomposition that organises everything

Every lossless compressor, without exception, is two components:

```
    ┌─────────┐   probabilities   ┌──────────┐
    │  MODEL  │ ────────────────> │  CODER   │ ──> bits
    └─────────┘                   └──────────┘
     predicts the                  turns a probability
     next symbol                   into a bit-length
```

- The **model** decides `p(next symbol | everything so far)`. All the domain knowledge lives here.
- The **coder** turns those probabilities into bits, at a cost of `−log₂ p` bits per symbol.

The coder is a solved problem: arithmetic coding and ANS both achieve `−log₂ p` to within a
fraction of a percent (§7.4, verified). **All remaining progress in lossless compression is
modelling.** Huffman, arithmetic, range, ANS are all coders. LZ77, LZ78, context mixing, PPM, and
a 70-billion-parameter transformer are all models.

Say this out loud in the first ten minutes of the unit. It converts a zoo of algorithms into two
boxes, and it is the same decomposition as §1.6's `H(p,q) = H(p) + D_KL(p‖q)`: the model's
badness is the `D_KL` term, the coder is what turns `q` into bits.

---

## 2.1 Prefix codes and the Kraft inequality

A **prefix code** (a.k.a. prefix-free, or confusingly "instantaneous") is one where no codeword is
a prefix of another. That property makes the code uniquely decodable *with no lookahead*: read bits
until you have a codeword, emit it, reset.

Drawn as a binary tree, symbols live at the leaves, and the path from root to leaf is the codeword:

```
            root
           /    \
          0      1
         / \    / \
        a   *  c   d          a=00  b=01  c=10  d=11
           / \
          b   ...
```

**Kraft–McMillan inequality.** A prefix code with lengths `ℓ₁…ℓₙ` exists **iff**

```
    Σ 2^(-ℓᵢ)  ≤  1
```

with equality exactly when the code tree is *complete* (no unused leaves). McMillan's half of the
theorem says the same bound applies to *any* uniquely decodable code, so restricting to prefix
codes costs nothing at all. That is a genuinely useful thing to know: there is no cleverness to be
had outside prefix codes.

Read `2^(-ℓ)` as an implied probability. **A code *is* a probability model**, always. A codeword of
length 3 asserts `p = 1/8`. If the true probability isn't `1/8`, you pay the KL divergence. The
verified Huffman run in §7.3 produces a Kraft sum of exactly `1.0000000000` — the tree is complete.

## 2.2 Huffman coding

Huffman (1952) is the optimal prefix code, and the construction is famously simple. It came out of
a term paper: Huffman was a graduate student who took the option of writing a paper instead of
sitting the final, and solved a problem his professor (Fano) had been unable to.

### Construction

```
    1. Put every symbol in a min-priority queue, keyed by frequency.
    2. While more than one node remains:
         pop the two smallest, a and b
         create a parent with freq(a)+freq(b), children a and b
         push the parent
    3. The remaining node is the root. Left edge = 0, right edge = 1.
```

`O(n log n)` with a heap, `O(n)` if the frequencies arrive sorted (two-queue trick).

Worked, on `A:45 B:13 C:12 D:16 E:9 F:5`:

```
  step 1:  E(9) + F(5)  = 14
  step 2:  C(12) + B(13) = 25
  step 3:  D(16) + 14    = 30
  step 4:  25 + 30       = 55
  step 5:  A(45) + 55    = 100

  A=0 (1 bit), B=101, C=100, D=111, E=1101, F=1100
  L_avg = (45·1 + 13·3 + 12·3 + 16·3 + 9·4 + 5·4)/100 = 2.24 bits
  H     = 2.23 bits
```

### Why it's optimal (the exchange argument)

Two observations:
1. In an optimal prefix code, the **two least frequent symbols have the longest, equal-length
   codewords, and are siblings**. If they weren't the longest, swapping with a longer, more
   frequent codeword strictly reduces the average length. If the longest codeword had no sibling,
   you could shorten it by one bit for free.
2. Given (1), merging the two least frequent symbols into a single symbol of combined frequency
   reduces the problem to `n−1` symbols, and the optimal code for the smaller problem extends to
   an optimal code for the larger one.

Induction on (2) with base case `n = 2` gives optimality. Huffman is *provably* the best prefix
code for a known, memoryless, per-symbol model. Nothing beats it *in that class*.

### The bound, and the limitation

```
    H(X)  ≤  L_Huffman  <  H(X) + 1
```

The lower bound is the source coding theorem. The upper bound is Huffman-specific: you never lose
more than one bit per symbol. Verified in §7.3: `H = 4.46100`, `L = 4.52326` on real text — a
1.4% overhead, which on a 29-symbol alphabet is fine.

**But the "+1" is per symbol, and that is the fatal limitation.** Huffman must assign an integer
number of bits to each symbol, and the ideal length `−log₂ p` is almost never an integer.
Verified, §7.3:

```
  p=0.50  H=1.0000 bit   Huffman=1.0000 bit   overhead    0.0%
  p=0.60  H=0.9710       Huffman=1.0000       overhead    3.0%
  p=0.70  H=0.8813       Huffman=1.0000       overhead   13.5%
  p=0.80  H=0.7219       Huffman=1.0000       overhead   38.5%
  p=0.90  H=0.4690       Huffman=1.0000       overhead  113.2%
  p=0.99  H=0.0808       Huffman=1.0000       overhead 1137.7%
```

A binary source with `p = 0.99` has entropy 0.08 bits. Huffman spends 1.0. **It is 12× worse than
optimal**, and there is nothing to fix — with two symbols, the shortest prefix code is one bit
each, and that's that.

This is not a corner case. It is the *normal* case in any modern codec, where you are constantly
coding highly skewed binary decisions: "is this DCT coefficient zero?" (usually yes), "is this
pixel the same as the one above?" (usually yes), "did this branch predict correctly?" Skewed
binary decisions are the bread and butter of compression, and they are precisely where Huffman
collapses. Hence §2.3.

### Canonical Huffman — what real formats actually transmit

You cannot ship the tree; it's expensive. The trick: **the code lengths alone determine a
canonical code.** Sort symbols by (length, symbol value), assign codes in increasing numeric order,
shifting left when the length increases:

```
    code = 0
    for length L = 1, 2, 3, …:
        for each symbol with length L, in symbol order:
            assign code; code += 1
        code <<= 1
```

RFC 1951 states the rule exactly: *"All codes of a given bit length have lexicographically
consecutive values, in the same order as the symbols they represent"* and *"Shorter codes
lexicographically precede longer codes."* So DEFLATE only transmits a list of code lengths — and
then compresses *that* list with a second, tiny Huffman code (the "code length alphabet", symbols
0–18, where 16 means "repeat previous length 3–6 times", 17 and 18 mean runs of zeros). A Huffman
code for the Huffman code. Verified end to end in §7.3: encode with canonical codes, decode with a
first-code/count table, round-trip PASS.

Canonical codes also make decoding fast: you don't walk a tree, you compare the accumulated bits
against the first code of each length and index into a flat array. That is what `zlib`'s inflate
does, and what a hardware DEFLATE engine does.

## 2.3 Arithmetic coding — fractional bits, at last

The idea that fixes Huffman: **stop assigning bits to symbols. Assign an interval to the whole
message.**

Start with `[0, 1)`. Each symbol subdivides the current interval in proportion to its probability.
After the whole message, transmit *any* number inside the final interval, in binary, using as few
bits as possible.

```
   encoding "aba" with p(a)=0.7, p(b)=0.3

   0                                            1
   |─────────────────────────────────|──────────|
   |<──────────── a: 0.7 ────────────>|<─ b ────>|
   after 'a':  [0, 0.7)

   0                                0.7
   |─────────────────────|──────────|
   |<──── a: 0.49 ──────>|<─ b ────>|
   after 'b':  [0.49, 0.7)

   0.49                          0.7
   |──────────────────|──────────|
   |<─── a: 0.147 ───>|<─ b ────>|
   after 'a':  [0.49, 0.637)

   final interval width = 0.7 · 0.3 · 0.7 = 0.147
   bits needed ≈ -log2(0.147) = 2.77
```

The final interval width is exactly `∏ p(xᵢ)`, so the number of bits is
`−log₂ ∏ p(xᵢ) = Σ −log₂ p(xᵢ)` — **the message's information content, to within two bits total**
(not per symbol). The per-symbol overhead goes to zero as the message grows.

**Verified, §7.4:** on a 200,000-symbol binary source with `P(a) = 0.899`, entropy `0.47315`
bits/symbol, the arithmetic coder produced **94631 bits = 0.47315 bits/symbol**, agreeing with the
entropy to five decimal places, and round-tripped exactly. Huffman on the same source costs
1.00000 bits/symbol. **Arithmetic coding is 52.7% smaller.**

### The three implementation problems, and their standard fixes

Real arithmetic coding is fiddly, and the fiddliness is instructive because every fix is forced.

**(1) Infinite precision.** The interval shrinks forever; you cannot hold it in a `double`.
*Fix — renormalisation:* keep `low` and `high` as 32-bit integers. As soon as their top bits agree,
that bit of the answer is decided forever: **output it and shift left**. The interval re-expands.

```
   if high < HALF:            output 0, shift        (both in the bottom half)
   if low  >= HALF:           output 1, shift        (both in the top half)
```

**(2) Underflow / straddling.** The interval can converge on `0.5` from both sides — `low = 0.4999`,
`high = 0.5001` — so no top bit is ever decided, and precision drains away.
*Fix — pending bits (the "E3" case):* if `low ≥ ¼` and `high < ¾`, delete the *second* bit of both,
scale about the midpoint, and increment a counter of pending bits. When the next real bit `b` is
finally output, emit `b` followed by `pending` copies of `¬b`. The bookkeeping is three lines and
it is where every from-scratch implementation breaks. §7.4's implementation handles it and is
verified to round-trip 200,000 symbols.

**(3) Carry propagation.** Adding to `low` can carry into already-emitted bytes.
*Fix:* either the pending-bit scheme above (bit-oriented, no carries escape), or byte-stuffing.

### Range coding

**Range coding** (Martin, 1979 — actually *predating* the arithmetic-coding patents) is the same
algorithm with byte-oriented renormalisation instead of bit-oriented, and a slightly different
carry handling. It is arithmetic coding with the constants changed. Its historical significance is
almost entirely legal: **IBM's and others' arithmetic-coding patents (particularly around the
Q-coder and the JBIG/JPEG arithmetic option) suppressed adoption for two decades**, which is why
JPEG's arithmetic-coding mode — 5–10% better than its Huffman mode, and part of the standard since
1992 — is supported by essentially no decoder you will ever encounter. Range coding was used
instead in LZMA (7-Zip), and in bzip2's competitors, precisely because it was believed to be
outside the patent claims.

The patents expired around 2004. By then ANS was coming.

### Adaptive vs static models

Both Huffman and arithmetic coding can be **static** (transmit the model, then the data) or
**adaptive** (update the model from the symbols already decoded — the decoder can do the same
update, so nothing needs transmitting). Adaptive arithmetic coding with a context model is the
basis of:

- **CABAC** (Context-Adaptive Binary Arithmetic Coding) in H.264/H.265/H.266 — every syntax element
  is binarised and coded with a context-selected adaptive binary model. It is why modern video
  encoders are 10–20% smaller than their Huffman-ish predecessors, and why CABAC decode is
  inherently serial and therefore the hardest part of a video decoder to parallelise.
- **PPM** (Prediction by Partial Matching), **CM** (Context Mixing), and **PAQ**, which mixes
  hundreds of models with a neural network and holds the top of every compression benchmark while
  running about 10,000× slower than gzip.

## 2.4 ANS and rANS — the modern answer

Arithmetic coding is optimal and slow. Huffman is fast and lossy-in-rate. Jarek Duda's
**Asymmetric Numeral Systems** (arXiv:1311.2540, 2013) is the third option, and the subtitle of the
paper is the pitch: *"entropy coding combining speed of Huffman coding with compression rate of
arithmetic coding."* The abstract claims about **50% faster decoding than Huffman** for a
256-symbol alphabet with compression rate similar to arithmetic coding.

### The idea

Arithmetic coding keeps a *range* — two numbers. ANS keeps a **single natural number `x`** as its
entire state. Encoding symbol `s` transforms `x → C(s, x)` such that `x` grows by roughly a factor
of `1/p(s)`; decoding recovers `(s, x)` from the new state. The information is stored in *which*
number you're at, not in an interval's endpoints.

For **rANS** ("range ANS"), with symbol frequencies `f_s` summing to `M = 2^k` and cumulative
frequencies `c_s`:

```
    encode:   x' = (x / f_s) · M  +  (x mod f_s)  +  c_s
    decode:   slot = x mod M
              s    = symbol owning that slot
              x'   = f_s · (x / M)  +  slot − c_s
```

That is it. Two divisions (or, with a precomputed reciprocal, two multiplies) and some adds. No
branchy renormalisation loop with pending-bit bookkeeping — just "while `x` is too big, emit 16
bits and shift".

**Verified, §7.4:** rANS on the same 200,000-symbol source produced **0.47328 bits/symbol** against
the entropy of `0.47315` — a **0.03% overhead** — and round-tripped exactly. It is, for practical
purposes, as good as arithmetic coding.

### The one weird thing: encoding runs backwards

rANS's decoder consumes symbols in the opposite order to the encoder's production. So an rANS
encoder **encodes the buffer in reverse** and the decoder reads forward (or vice versa). This is
strange the first time and it is the reason ANS is block-based rather than streaming, which in turn
is fine, because everything modern is block-based anyway.

### tANS / FSE — the table-driven variant

**tANS** ("tabled ANS") precomputes the entire state machine into a lookup table. Encoding and
decoding become *table lookups and shifts* — no multiplication at all. Yann Collet's implementation
is **FSE** (Finite State Entropy), and it is a drop-in replacement for Huffman with the rate of
arithmetic coding and better-than-Huffman speed.

**This is what made Zstandard possible.** Zstd uses FSE for its literal-length, match-length and
offset symbols, and Huffman (a fast, 4-stream, SIMD-friendly one) for raw literals — using each
where it wins. Without ANS there is no zstd, and without zstd the compression/speed frontier of
2015 would still be roughly where 1995 left it.

ANS is now everywhere: **Zstandard, LZFSE (Apple), JPEG XL, AV1's earlier drafts, Dropbox's
DivANS, CRAM (genomics), and the Linux kernel's built-in zstd**. Duda deliberately published
without patenting and has actively fought patent applications on it, which is a large part of why
adoption was so fast.

### The coder comparison, summarised

| | Huffman | Arithmetic | Range | rANS | tANS/FSE |
|---|---|---|---|---|---|
| bits per symbol | integer | fractional | fractional | fractional | fractional |
| overhead vs `H` | up to +1 bit/sym | ~0 (verified: 0.000%) | ~0 | ~0 (verified: 0.03%) | ~0.1% |
| state | code table | 2 registers | 2 registers | **1 register** | table index |
| encode order | forward | forward | forward | **backward** | backward |
| per-symbol cost | table lookup | mul + branchy renorm | mul + renorm | 2 mul | **table lookup** |
| adaptive models | awkward (rebuild tree) | natural | natural | awkward | awkward |
| used by | DEFLATE, JPEG | CABAC, JBIG2, PAQ | LZMA | zstd, JPEG XL | **zstd**, LZFSE |

The row that decides architecture is "adaptive models". Arithmetic coding lets you update
probabilities per symbol for free, which is why *video* uses it (CABAC) — video's statistics change
constantly. ANS wants a static table per block, which is why *general-purpose file compressors* use
it — they can afford to scan a block, build a table, and ship it.

---

## 2.5 LZ77 — the sliding window

Ziv and Lempel, 1977. The insight is not statistical at all: **text repeats itself, so replace a
repeat with a pointer to the earlier occurrence.**

Output is a stream of two token types:

- a **literal**: this byte, emitted directly;
- a **match** `⟨distance, length⟩`: "copy `length` bytes from `distance` bytes ago".

```
  input:   the rain in spain falls mainly on the plain. the rain in spain…
                                                        ^^^^^^^^^^^^^^^^^^
  output:  ... lit'.' lit' ' ⟨45, 45⟩ ...
                             copy 45 bytes from 45 back
```

Two things make it work in practice, and both are subtle:

**Overlapping matches are legal, and are the RLE mechanism.** `⟨1, 100⟩` means "copy 1 byte from 1
back, 100 times" — which is a run-length encoding of 100 identical bytes, expressed with no special
case. The decoder must copy **byte by byte**, not with `memcpy`, or overlapping matches break. This
is the single most common bug in a from-scratch LZ77 and is worth making the student hit.

**Match finding is the whole cost.** Naively, for each position you search the entire window for the
longest match: `O(n · W)`. Real implementations use a **hash chain**: hash the next 3 bytes, look up
a linked list of previous positions with the same 3-byte hash, and walk it. The chain-walk depth
is *the* speed/ratio knob — `zlib`'s levels 1–9 are, more than anything else,
`max_chain_length` settings (from 4 at level 1 to 4096 at level 9). Higher levels also enable
**lazy matching**: after finding a match at position `i`, check whether position `i+1` has a
*better* match, and if so emit a literal and take the better one.

Modern high-ratio encoders replace hash chains with **binary trees** (`zstd --ultra`, LZMA) or
**suffix automata**, and the very best use **optimal parsing** — a shortest-path search over the
lattice of "which token sequence minimises total encoded bits", which requires knowing the entropy
coder's costs, which is why high compression levels are slow: they run the entropy coder's cost
model inside the match finder.

**Verified, §7.5:** a 32 KiB-window, hash-chain LZ77 on 6750 bytes of repetitive English produced
27 literals and 32 matches with average match length 210, covering 99.6% of the input, and
round-tripped exactly.

### The window size trade

The window is the compressor's memory. Bigger window = more matches found = better ratio, but more
memory *on the decoder* (which must buffer the window) and more expensive match search.

| format | window |
|---|---|
| DEFLATE (gzip, zlib, PNG) | **32 KiB**, fixed |
| Brotli | 1 KiB – 16 MiB (`(1 << WBITS) − 16`, WBITS 10–24) |
| Zstandard | 1 KiB – 2 GiB (default 8 MiB at level 19; `--long` extends further) |
| LZMA / xz | up to 1.5 GiB |

The 32 KiB DEFLATE window is a 1991 decision about the memory of a 1991 machine, and it is the
single biggest reason gzip loses to zstd on modern files: a 4 MB JSON document with structure
repeating every 100 KB is invisible to gzip and obvious to zstd.

## 2.6 LZ78 and LZW — the explicit dictionary

Ziv and Lempel's 1978 follow-up takes a different route: instead of pointing into the raw past,
**build an explicit dictionary of phrases**, and emit dictionary indices.

**LZW** (Welch, 1984) is the famous refinement. The dictionary starts pre-loaded with all 256 single
bytes; the encoder finds the longest string in the dictionary matching the current position, emits
its index, and adds *that string plus the next character* as a new entry.

```
  input: A B A B A B A
  dict starts: 0..255 = single bytes

  see "A"   → in dict.  read "AB" → not in dict.
              emit code('A'), add "AB" as 256.
  see "B"   → in dict.  read "BA" → not in dict.
              emit code('B'), add "BA" as 257.
  see "AB"  → in dict (256).  read "ABA" → not in dict.
              emit 256, add "ABA" as 258.
  …
```

The decoder rebuilds the identical dictionary from the codes alone — no dictionary is transmitted.
There is one genuinely tricky case (the `cScSc` pattern, where the decoder receives a code it has
not yet defined) which every implementation must special-case, and which is a lovely exercise in
its own right.

### Why LZ78/LZW lost

LZW was in **GIF, TIFF, PDF, and Unix `compress`**, and then Unisys began enforcing US Patent
4,558,302 in 1994 — including, notoriously, demanding fees from shareware GIF encoder authors. The
resulting backlash produced **PNG**, deliberately built on the patent-free DEFLATE, and PNG won.
The patent expired in 2003–2004; by then nobody cared. LZ77 variants had won on the merits too:
sliding windows adapt to local statistics better than a monotonically-growing dictionary, and match
finding turned out to be cheaper than dictionary management.

The lasting lesson is not technical. **Two of the most important algorithms in this section
(arithmetic coding, LZW) were held back by a decade or two of patent enforcement, and the formats
you use today were chosen substantially to route around them.** DEFLATE, PNG, Vorbis, Opus, VP8/9,
AV1, and ANS are all, in part, patent-avoidance artefacts.

## 2.7 DEFLATE — LZ77 + Huffman, and the format you actually have

RFC 1951. This is `gzip`, `zlib`, `PNG`, `zip`, HTTP `Content-Encoding: gzip`, the PNG chunks in
every screenshot you take, and the on-disk format of a `.git` loose object.

The structure, exactly as specified:

- A stream is a sequence of **blocks**, each with a 3-bit header: 1 bit "final block?", 2 bits type.
- **Type 00 — stored**: no compression, byte-aligned, length-prefixed. This is the escape hatch
  that bounds worst-case expansion.
- **Type 01 — fixed Huffman**: a hardcoded code table baked into the spec. No table to transmit;
  good for small blocks.
- **Type 10 — dynamic Huffman**: the encoder ships its own code lengths, themselves Huffman-coded
  (`HLIT + 257` literal/length lengths, `HDIST + 1` distance lengths, run-length coded with symbols
  16/17/18).
- **Type 11 — reserved (error).**

The LZ77 layer: **window up to 32 KiB**, match lengths **3–258 bytes**, distances **1–32768**.
Literals and lengths share one alphabet of 286 symbols (0–255 literals, 256 = end-of-block, 257–285
length codes, with extra bits appended for the ranges); distances use a separate 30-symbol
alphabet, also with extra bits. So a match is: one Huffman-coded length symbol, some raw extra
bits, one Huffman-coded distance symbol, some more extra bits. This hybrid — Huffman on the
*magnitude class*, raw bits on the *offset within the class* — is a pattern you will see again in
JPEG, in Zstandard, and in every format that has to code integers with a wide dynamic range.

**Why it's still everywhere in 2026** despite being beaten on every axis: it is in every language's
standard library, every OS, every browser, several CPU instruction sets' worth of hardware
accelerators (Intel QAT, IBM z15's on-chip DEFLATE, Nvidia's nvCOMP), and roughly a hundred file
format specifications that cannot change. It is a Schelling point, not an optimum.

**Verified, §7.1:** zlib at level 6 compressed 7520 bytes of repeated English prose to 286 bytes
(26×), and 9000 bytes of pseudo-random letters to 5628 bytes — *larger* than the 5285-byte order-0
entropy floor. Note also that **level 9 gave identical output to level 6** on these inputs: the extra
chain-walking found nothing more. That is a useful lesson about `-9` in general.

## 2.8 Zstandard

Yann Collet, Facebook/Meta, 2015; RFC 8878. Zstd is the current default answer, and understanding
*why* is the point of this subsection.

Zstd is LZ77 with:
- a **large window** (default 8 MiB at high levels, up to 2 GiB with `--long`);
- **FSE/tANS** entropy coding for match lengths, literal lengths, and offsets (§2.4);
- a fast, multi-stream, SIMD-friendly **Huffman** for the literals themselves;
- **repeat-offset codes** — the last three offsets used are cheap to re-encode, which is enormously
  effective on structured data like columnar records or a struct-of-arrays;
- **optional trained dictionaries** (§2.10);
- **negative levels** (`--fast=N`) that trade ratio for LZ4-class speed;
- a **frame format with an optional XXH64 checksum** (§5), and support for multi-frame concatenation.

The published benchmark, on the Silesia corpus, Core i7-9700K @ 4.9 GHz, Ubuntu 24.04, lzbench with
gcc 14.2 (from the zstd README, fetched):

| compressor | ratio | compress MB/s | decompress MB/s |
|---|---|---|---|
| **zstd 1.5.7 -1** | **2.896** | **510** | **1550** |
| brotli 1.1.0 -1 | 2.883 | 290 | 425 |
| **zlib 1.3.1 -1** | 2.743 | **105** | **390** |
| zstd 1.5.7 --fast=1 | 2.439 | 545 | 1850 |
| quicklz 1.5.0 -1 | 2.238 | 520 | 750 |
| zstd 1.5.7 --fast=4 | 2.146 | 665 | 2050 |
| lzo1x 2.10 -1 | 2.106 | 650 | 780 |
| **lz4 1.10.0** | 2.101 | 675 | **3850** |
| snappy 1.2.1 | 2.089 | 520 | 1500 |
| lzf 3.6 -1 | 2.077 | 410 | 820 |

Read the first and third rows together, because that comparison is the entire reason zstd took
over: **at its fastest level, zstd compresses better than zlib does, while compressing ~5× faster
and decompressing ~4× faster.** It is not a trade-off. It strictly dominates. That happens rarely
enough in systems engineering to be worth pointing at.

Zstd is now the default in the Linux kernel's initramfs and module compression, btrfs, ZFS, Arch
and Fedora package compression, RocksDB, ClickHouse, Kafka, and Docker/OCI image layers.

## 2.9 Brotli

Google, 2016; RFC 7932. Built for one job: **HTTP `Content-Encoding: br`.**

Everything in it follows from the observation that the web sends millions of small, similar,
text-shaped documents. The distinguishing features, per the RFC:

- **Window `(1 << WBITS) − 16` for WBITS 10–24**, i.e. 1 KiB − 16 B up to 16 MiB − 16 B.
- A **built-in static dictionary of 122,784 bytes** containing common web strings (words of length
  4–24), plus **121 transforms** per base word (identity, capitalise-first, capitalise-all,
  omit-first-1..9, omit-last-1..9, and suffix/prefix additions). So a 400-byte HTML page can
  reference `"<!DOCTYPE html>"` or `"</script>"` without ever having seen them — the dictionary
  makes tiny files compress well, which DEFLATE fundamentally cannot do.
- **Context modelling** for literals: four context modes (LSB6, MSB6, UTF8, Signed) selecting among
  multiple prefix codes based on the previous one or two bytes. The UTF8 mode is explicitly tuned
  for text.
- **Block switching**: the stream can change prefix codes mid-block for literals, insert-and-copy
  lengths, and distances independently.

Brotli at high levels beats gzip by ~15–25% on HTML/CSS/JS, and its *decode* speed is roughly
gzip-class, which is what matters for a browser. Its encode speed at level 11 is dreadful, which is
also fine — you compress static assets once at build time and serve them a million times. The
asymmetry is the design.

**The dictionary idea generalises, and this is the transferable lesson.** Zstd exposes it as
`zstd --train`: point it at a thousand sample records, get a dictionary, ship the dictionary to
both ends, and small-message compression improves by 2–5×. For an RPC system sending 300-byte
protobufs, a trained dictionary is the difference between compression being useless and
compression halving your egress bill.

## 2.10 LZ4, Snappy — when speed is the whole point

**LZ4** (Collet, 2011) is LZ77 with **no entropy coder at all**. Matches and literals are written in
a simple byte-oriented format with nibble-packed lengths. There is no Huffman, no FSE, no
bit-twiddling on the decode path — decoding is `memcpy` in a loop, and the benchmark above shows
**3850 MB/s decompression**, roughly memory bandwidth.

**Snappy** (Google, 2011) is the same philosophy with a slightly different format, built for
BigTable/LevelDB.

The rule that makes this a design decision rather than a preference:

> **Compress if `(uncompressed_size − compressed_size) / bandwidth > compression_time`.**

Compression is worth it when the bytes you *don't* move cost more time than the compression does.
Written per-byte, LZ4 at 675 MB/s compress + 3850 MB/s decompress pays for itself against any
storage or network slower than about 500 MB/s — which is every network below 10 GbE and every
spinning disk ever made. Against DRAM (100+ GB/s) it does not pay, which is why in-memory
compression is a specialised trade (and why the interesting in-memory techniques are the
§2.12 columnar ones, which are *cheaper than a copy*).

This is also the whole argument for **compressed swap** (`zram`, `zswap`): compressing a page with
LZ4/LZO at ~1 GB/s is thousands of times faster than writing it to disk, so trading CPU for
avoided I/O is trivially correct. Every Android phone and every Chromebook does this by default.

## 2.11 bzip2 and the Burrows–Wheeler Transform

The BWT is the most beautiful algorithm in this document, and it belongs in the curriculum for
aesthetic reasons alone. It is also, surprisingly, the foundation of modern genomics.

### The transform

Take a string. Form **all `n` cyclic rotations**. **Sort them.** Output the **last column** — plus
the index of the row containing the original string.

```
   "banana"                    sorted rotations        last column
   ─────────                   ────────────────        ───────────
   banana                      abanan                       n
   ananab                      anaban                       n
   nanaba                      ananab                       b
   anaban                      banana   ← row 3            [a]      ← primary index = 3
   nabana                      nabana                       a
   abanan                      nanaba                       a

   BWT("banana") = "nnbaaa",  primary index 3
```

**Verified, §7.5:** `BWT("banana") = "nnbaaa"`, primary index 3, and the inverse round-trips.

### Why it helps

The last column of the sorted-rotation matrix is *the character preceding each sorted suffix*.
Since the suffixes are sorted, contexts that look alike end up adjacent, and in English the
character before `"he "` is overwhelmingly `t`. So the output clusters into long runs of identical
characters. **Verified, §7.5:** on 4000 bytes of repetitive English, runs-per-byte fell from
`0.9778` to `0.0088` — **111× fewer runs** — and the output begins with 60 consecutive `n`
characters. The transform adds no information (it is a permutation!) but makes the redundancy
*local*, where a cheap coder can reach it.

### Why the inverse works — the part that feels like magic

You are given only the last column `L` and the primary index. That seems like nowhere near enough.
But:

1. The **first column `F` is just `L` sorted** — the matrix rows are sorted, so the first column is
   the sorted multiset of characters, which is the sorted multiset of `L`.
2. Because the rows are *rotations*, `L[i]` is the character that **cyclically precedes** `F[i]`.
3. The `k`-th occurrence of character `c` in `L` corresponds to the `k`-th occurrence of `c` in `F`
   (rank preservation — this is the "LF-mapping" and it is the whole trick; it holds because rows
   starting with `c` are sorted by what follows `c`, and rows ending with `c` are sorted by what
   follows `c` too).

So build an array `LF[i] = (position in F of the character L[i])`, start at the primary index, and
walk. `O(n)` time, `O(n)` space. The verified implementation in §7.5 is 12 lines.

### bzip2's full pipeline

```
    input
      → RLE (initial, to kill pathological runs)
      → BWT (on blocks of 100–900 KB)
      → MTF (move-to-front: recode each byte as its index in a
             recently-used list, turning runs into runs of zeros)
      → RLE (on the zeros, which are now abundant)
      → Huffman (with multiple tables, selected per 50-symbol group)
```

bzip2 beats gzip by 10–15% on text. It lost to xz (LZMA) on ratio and to zstd on everything, and
its main problem is that BWT block sorting is slow in both directions — bzip2 *decompression* is
slow, which is unusual and unforgivable. It is essentially deprecated for new work.

### But the BWT itself is thriving — in bioinformatics

The BWT plus a rank/select structure gives the **FM-index** (Ferragina–Manzini, 2000): a
*compressed* full-text index that supports substring search in time proportional to the **pattern**
length, independent of the text length, in space close to the compressed size of the text.

This is the core of **Bowtie, BWA, and every short-read aligner in genomics.** The human reference
genome is ~3.1 Gbp; an FM-index of it fits in a couple of gigabytes and answers "where does this
100-base read occur" in microseconds. Read alignment for an entire sequencing run is a BWT
computation. The same structure appears in `ripgrep`-adjacent research indexes, in some
full-text search engines, and in the "compressed suffix array" literature generally.

Tell students this. "A 1994 DEC research report on data compression is why we can sequence
genomes" is the kind of fact that makes a subject stick.

## 2.12 Delta, dictionary, and the columnar/database family

Everything above assumes a byte stream. Databases don't have byte streams; they have **columns of
typed values**, and columns compress by completely different means — means that are often *faster
than memcpy* because they reduce the amount of data touched.

This is the section that the storage track will lean on hardest.

### The techniques

**Run-length encoding (RLE).** `⟨value, count⟩`. Devastatingly effective on sorted or
low-cardinality columns. A `country` column in a table sorted by country is nearly free.

**Dictionary encoding.** Replace each distinct value with a small integer id, store the dictionary
once. A `status` column of 10-byte strings with 5 distinct values becomes 3 bits per row.
**Crucially, comparisons can run on the ids** — `WHERE status = 'ACTIVE'` becomes an integer
compare against the dictionary lookup, so you never materialise the strings. This is the single
most important columnar compression technique and it is a *query accelerator*, not just a space
saver. Parquet, ORC, ClickHouse (`LowCardinality`), DuckDB, Arrow, and every vectorised engine do
this.

**Bit-packing.** If a column's values fit in 11 bits, store 11 bits each, not 32. Combined with
SIMD unpacking (`_mm256_srlv_epi32` and friends) this runs at many GB/s.

**Frame of reference (FOR).** Store `min` per block, then `value − min` bit-packed. Timestamps in a
one-hour block need 12 bits, not 64.

**Delta encoding.** Store differences. For a sorted or monotonic column — primary keys, timestamps,
sequence numbers — deltas are tiny and often constant. **Delta-of-delta** (used by Facebook's
Gorilla time-series format and by Prometheus) stores the second difference: for a metric scraped
every 15 s, the delta is always 15 and the delta-of-delta is always 0, which RLEs to nothing.
Gorilla reported compressing timestamps to ~2 bits and float values to ~1.4 bytes on average.

**XOR encoding for floats.** Gorilla again: XOR successive doubles; for slowly-varying metrics the
result has many leading and trailing zero bits, so encode "number of leading zeros, number of
meaningful bits, the bits". A CPU-utilisation series compresses ~10×.

**Roaring bitmaps.** For sets of integers (index postings lists, selection vectors), choose per
64K-chunk between an array, a bitmap, and a run container based on density. Used by Lucene,
Elasticsearch, ClickHouse, Druid, InfluxDB, Spark, and Pinot.

**Then a general-purpose codec on top.** Parquet applies dictionary + RLE/bit-packing per column
chunk, then LZ4/Snappy/zstd/gzip over the result — the structural encoding first, the byte-stream
codec second. The ordering matters enormously: dictionary-encoded ids compress far better than raw
strings, because the structural pass has already removed the redundancy that the byte codec would
have had to find the hard way.

### The two systems lessons

**(1) Sort order is a compression parameter.** Sorting a table by its lowest-cardinality column
first can improve compression 2–10× by lengthening RLE runs, at the cost of a sort. ClickHouse's
`ORDER BY` in a `MergeTree` is a compression decision, an index decision, and a query-locality
decision *simultaneously*, and that is why choosing it well is the single highest-leverage
schema decision in these systems.

**(2) Late materialisation.** Because dictionary ids and bit-packed integers are directly
comparable, a vectorised engine filters, joins, and aggregates on the *encoded* representation and
only decodes at the very end (often only for the rows that survive). Compression stops being a
space/time trade and becomes a pure win: less memory bandwidth, more values per cache line, more
lanes per SIMD register. **On a modern CPU, compressed columnar scans are faster than uncompressed
ones**, because everything is memory-bound and compression is the only real way to buy bandwidth.

That last sentence is the bridge to the storage track and should be delivered as the punchline.

## 2.13 ★ The ratio-vs-speed curve, and how to choose a point on it

The single most practically useful picture in compression. Plot compression ratio against speed
(log scale) and every codec sits on a frontier:

```
  ratio
   ^
 8 |                                                    · xz -9 / zstd -19
   |                                          · brotli -11
 6 |                              · zstd -9
   |                        · brotli -5
 4 |                · zstd -3
   |          · zlib -6
 3 |     · zstd -1  · brotli -1
   |  · zlib -1
 2 |· lz4  · snappy
   |
 1 +----+-------+--------+---------+----------+---------->  compress speed
     1 MB/s  10 MB/s  100 MB/s   500 MB/s   1 GB/s        (log)
```

*(schematic, arranged from the measured table in §2.8 plus the general shape; the exact positions
depend on corpus and hardware)*

Three facts about this curve that decide real designs:

1. **Decompression speed is nearly flat across levels within a codec.** zstd level 1 and level 19
   decompress at similar speeds; compressing harder costs *encode* time, not decode time. So for
   write-once-read-many data — static web assets, container images, package repositories, cold
   storage, a model checkpoint downloaded ten thousand times — **always use the highest level you
   can afford at build time.** It is free at read time.
2. **The frontier moves; old codecs are strictly dominated.** zlib -1 is beaten by zstd -1 on ratio
   *and* on both speeds (§2.8, verified table). There is essentially no remaining reason to choose
   zlib for a new system except compatibility, and compatibility is a very good reason.
3. **The right question is never "which is best", it is "what is my bottleneck".**

### The decision procedure, as a table

| situation | the constraint | choose |
|---|---|---|
| network transfer, link slower than ~100 MB/s | bandwidth | zstd -3..-9, or brotli for HTTP |
| network transfer, 10–100 GbE | **CPU**, not bandwidth | lz4, or nothing at all |
| write-once, read-many (assets, packages, images) | encode is amortised | zstd -19, brotli -11, xz |
| write-heavy log/WAL ingestion | encode latency | lz4 / zstd -1 |
| RAM (zram/zswap, in-memory cache) | latency, and CPU is cheaper than a page fault | lz4 / lzo |
| archival, cold storage | ratio, nothing else | xz, zstd --ultra -22 |
| columnar analytics | scan bandwidth | dictionary + RLE + bit-pack, **then** lz4/zstd |
| many small similar messages (RPC, JSON events) | per-message overhead | zstd **with a trained dictionary** |
| already-compressed data (JPEG, MP4, encrypted) | nothing works | **do not compress** — you pay CPU for +0.03% |
| you must interoperate with 1996 | politics | gzip |

### And the measurement rule

**Benchmark on your data.** Silesia is a general corpus; your data is JSON, or Parquet pages, or
protobufs, or float32 tensors, and the ratios will differ by 3× from the published table. The
20-line benchmark — for each codec and level, record ratio, encode MB/s, decode MB/s on 100 MB of
*your* production data, print the table, pick the knee — takes an afternoon and settles the
argument permanently. Make it an exercise.

One special case worth stating flatly, because people get it wrong constantly: **model weights in
fp16/bf16 do not compress well with general-purpose codecs.** Mantissa bits are close to random.
A safetensors file gets maybe 5–15% from zstd, at real CPU cost. The compression that works on
weights is **quantisation** (§3.6) — lossy, structural, and 4–8×. Do not confuse the two.

---

# 3. Lossy Compression — briefly, but properly

## 3.1 The universal three-step shape

Every lossy codec ever built — JPEG, MP3, H.264, AV1, Opus, and **neural network quantisation** —
is the same three steps:

```
   ┌───────────┐    ┌────────────┐    ┌──────────────┐
   │ TRANSFORM │ →  │  QUANTISE  │ →  │ ENTROPY CODE │ → bits
   └───────────┘    └────────────┘    └──────────────┘
    decorrelate,     THE ONLY          lossless, §2
    concentrate      LOSSY STEP
    energy
```

**Step 1 — Transform.** Change basis so that the information concentrates into a few coefficients
and the rest are near zero. This step is *lossless and invertible*; it destroys nothing. Its job is
to make step 2's job easy. DCT, wavelet, MDCT, a random Hadamard rotation, a learned encoder — all
the same role.

**Step 2 — Quantise.** Divide each coefficient by a step size and round. **This is the only place
information is lost, in the entire pipeline.** Every artefact you have ever seen came from this
line of code. Choosing the step sizes *per coefficient* is where perceptual modelling lives: spend
precision where humans (or gradients) notice, and none where they don't.

**Step 3 — Entropy code.** The quantised coefficients are mostly zero and highly skewed, so §2
applies unchanged: run-length the zeros, Huffman or arithmetic-code the rest.

Once a student sees that the third step is just §2 and the first step is a matrix multiply, the
entire subject collapses to **"which transform, and which step sizes"** — and both of those
questions have the same answer everywhere: *whatever the consumer of the output can't tell the
difference about.* For JPEG that consumer is the human visual system; for a quantised network it's
the loss landscape.

## 3.2 JPEG, concretely

ITU-T T.81 / ISO 10918, 1992. Still, in 2026, the format of most photographs.

### The pipeline

```
  RGB
   → colour transform to YCbCr
   → chroma subsample (4:2:0)
   → split into 8×8 blocks, level-shift by −128
   → 2-D DCT-II per block
   → divide by an 8×8 quantisation table, round        ← LOSS
   → zigzag scan (low → high frequency)
   → DC: differential from previous block's DC
     AC: run-length code the zeros, Huffman the rest
   → bitstream
```

**Colour transform and chroma subsampling.** `Y` is luma, `Cb`/`Cr` are chroma. Human vision has
far higher spatial acuity for brightness than for colour (roughly 4:1 in the cone mosaic). So JPEG
throws away three quarters of the colour information before compressing anything: **4:2:0** stores
one `Cb` and one `Cr` sample per 2×2 luma block. That is a **2× size reduction before the DCT even
runs**, essentially for free perceptually — and it is the reason red text on a black background
looks smeared in a JPEG while white text on black looks fine.

**The DCT.** The 2-D DCT-II of an 8×8 block:

```
   F(u,v) = ¼ C(u)C(v) Σₓ Σᵧ f(x,y) cos((2x+1)uπ/16) cos((2y+1)vπ/16)
   C(0) = 1/√2, C(k>0) = 1
```

It is an orthonormal change of basis into 64 spatial-frequency patterns: `F(0,0)` is the block's
average ("DC"), and increasing `u,v` are increasingly fine horizontal/vertical ripples.

Why the DCT and not the DFT? Because the DFT of a finite block implicitly assumes periodic
extension, so the block's left and right edges are treated as adjacent, producing a spurious
discontinuity and enormous high-frequency energy. The DCT implicitly assumes *even* (mirror)
extension, which is continuous, so real images produce far less high-frequency energy. For
Markov-ish image statistics the DCT is very close to the optimal decorrelating transform (the
Karhunen–Loève transform) while having an `O(n log n)` fast algorithm and requiring no
data-dependent basis.

**Verified, §7.6:** on a smooth 8×8 block, the largest 8 of the 64 DCT coefficients hold
**99.59% of the block's energy**. That single number *is* the justification for the whole design.

**Quantisation.** The lossy step. Divide element-wise by an 8×8 table and round:

```
   Fq(u,v) = round( F(u,v) / Q(u,v) )
```

The standard's Annex K luminance table starts:

```
   16  11  10  16  24  40  51  61
   12  12  14  19  26  58  60  55
   14  13  16  24  40  57  69  56
   14  17  22  29  51  87  80  62
   18  22  37  56  68 109 103  77
   24  35  55  64  81 104 113  92
   49  64  78  87 103 121 120 101
   72  92  95  98 112 100 103  99
```

Small numbers top-left (low frequency, keep precision), large bottom-right (high frequency, throw
away). The "quality" slider is a scale factor on this table — libjpeg's rule is
`S = 5000/Q` for `Q < 50`, `S = 200 − 2Q` otherwise, then `q = clamp((Q₅₀·S + 50)/100, 1, 255)`.

**Verified, §7.6**, on that same block:

```
  quality   table scale   nonzero coeffs   RMSE
     95         10%          31/64         1.923
     75         50%          10/64         4.111
     50        100%           8/64         4.938
     25        200%           7/64         5.057
     10        500%           5/64         8.188
```

Quality 95 keeps 31 of 64 coefficients; quality 10 keeps 5. Everything else has been rounded to
zero — and zeros are what the entropy coder eats for free.

**Zigzag and entropy coding.** Scan the 8×8 block in a zigzag from DC outward, which orders
coefficients roughly by increasing frequency, which puts all the zeros at the end. Then code
`(run of zeros, size class)` pairs with Huffman, with the actual coefficient value appended as raw
bits — the same magnitude-class trick as DEFLATE (§2.7). A block whose only nonzero coefficient is
DC costs a handful of bits via the `EOB` (end-of-block) symbol.

DC coefficients are coded **differentially** from the previous block's DC, because adjacent blocks
have similar average brightness. This is a per-block delta encoding, exactly §2.12's idea.

### Where the artefacts come from — each traceable to one line

| artefact | cause |
|---|---|
| **Blocking** (8×8 grid visible) | blocks are quantised independently, so their DC values land on different levels and the edges no longer match |
| **Ringing / mosquito noise** near sharp edges | a step edge needs all 64 frequencies; killing the high ones leaves Gibbs ringing — the same overshoot as truncating any Fourier series |
| **Colour bleeding / smearing** | 4:2:0 chroma subsampling: colour is at half resolution in both axes |
| **Banding** in gradients | coarse quantisation of low-frequency coefficients; a smooth ramp becomes steps |
| **Generation loss** | re-encoding re-quantises coefficients that are already on a grid, and repeated round-to-nearest drifts. (Re-encoding at *identical* quality and alignment is nearly idempotent — the loss comes from changing quality or cropping off the 8×8 grid.) |

Ask a student to build a JPEG at quality 5, zoom in, and *name each artefact and its line of code*.
It takes ten minutes and it makes the transform-quantise-code pipeline permanent.

### What JPEG got wrong, and what replaced it

JPEG's arithmetic-coding mode (§2.3) is in the standard and 5–10% better than the Huffman mode, and
is supported by nothing, for patent reasons. **JPEG 2000** replaced the blocked DCT with a wavelet
transform (no blocking artefacts, graceful quality scaling) and lost anyway — too slow, too late,
patent uncertainty. **WebP** (VP8 intra), **AVIF** (AV1 intra) and **HEIC** (HEVC intra) get 30–50%
smaller at the same quality by borrowing video codecs' intra-prediction machinery. **JPEG XL** does
it while also losslessly recompressing existing JPEGs ~20% smaller, using ANS. And JPEG is still
the default everywhere, because Schelling points beat merit (§2.7).

## 3.3 Video, in outline — and why it is the most optimised software on earth

Video is JPEG plus **prediction in time**, and the time dimension is where all the gain is.

### Motion compensation

Consecutive frames are nearly identical. So instead of coding frame `t`, code the *difference*
between frame `t` and a **motion-compensated prediction** built from already-decoded frames:

```
   for each block in the current frame:
       search previous frame(s) for the best-matching block
       emit a MOTION VECTOR (dx, dy)
       emit the RESIDUAL (current − predicted), DCT'd + quantised
```

The residual of a good prediction is nearly zero everywhere, so it costs almost nothing. **Motion
estimation — searching for that best match — is 50–90% of encoder time**, and it is the single
biggest reason video encoding is expensive and video *decoding* is cheap. (The decoder is told the
motion vector; it never searches.)

Modern codecs go much further: sub-pixel motion vectors (quarter- or eighth-pel, with interpolation
filters), variable block sizes down to 4×4 and up to 128×128, multiple reference frames, global
motion models, overlapped block compensation, and in AV1/VVC, warped motion.

### Frame types

| type | predicted from | properties |
|---|---|---|
| **I-frame** (intra) | nothing — self-contained | large (JPEG-sized); a random-access point; a "keyframe" |
| **P-frame** (predicted) | earlier frames | ~10–20% of an I-frame |
| **B-frame** (bi-directional) | earlier **and later** frames | smallest; requires reordering |

B-frames are why **decode order ≠ display order**, why a container needs both PTS and DTS
timestamps, and why seeking in video is awkward: you must start at the previous I-frame and decode
forward. A "GOP" (group of pictures) of 250 frames means seeking can require decoding up to 10
seconds of video, which is why scrubbing is jerky on some players and smooth on others (the smooth
ones keep more keyframes, at a bitrate cost). Streaming formats (HLS/DASH) cut segments at
I-frames for exactly this reason.

### Rate control

The other half of a real encoder: given a bitrate budget, decide the quantisation parameter (QP)
per frame and per block, so that quality is even and the buffer never underruns. CBR, VBR, CRF
(constant-rate-factor: hold quality, let bitrate float), two-pass, and per-title encoding are all
rate control. The perceptual work — spending bits where the eye looks, e.g. adaptive quantisation
that gives flat regions more precision because banding is visible there — lives here too.

### Why it's the most optimised software on earth

Four forces, all pointing the same way:

1. **Video is most of the internet.** Depending on whose measurement you trust, video is roughly
   two-thirds to four-fifths of all consumer internet traffic. A 1% bitrate saving at Netflix or
   YouTube scale is worth an enormous amount of money, permanently.
2. **The search space is astronomically large.** Every block: which prediction mode, which
   reference, which motion vector, which partition, which transform, which QP. Encoders do
   rate-distortion optimisation — literally minimising `D + λR` (distortion plus lambda times rate)
   over a combinatorial space — and the difference between a good and a bad search is 30% bitrate.
3. **Decode must run on a phone, in real time, on battery.** So the decoder is fixed-function
   silicon in every SoC, and the *bitstream format* is co-designed with the hardware.
4. **Everyone competes on it publicly.** x264 and x265 are hand-written assembly for a dozen SIMD
   ISAs; `dav1d` (the AV1 decoder) is likewise. SVT-AV1, libaom, and the hardware encoders in
   NVENC/QuickSync/AMF are in a permanent public benchmark war.

The result: **x264 contains tens of thousands of lines of hand-written assembly** across MMX, SSE2,
SSSE3, AVX2, AVX-512, NEON, and more. `dav1d` likewise. These are among the most heavily
hand-optimised codebases in existence, and reading a single x264 SIMD kernel (`sad16x16`, say) is
an excellent humbling exercise for anyone who thinks the compiler will handle it.

The AI-track connection worth making: **this is what a mature, economically-forced optimisation
regime looks like** — and it is roughly where GPU kernel engineering for transformers is heading.
The same pattern (a small number of hot kernels, hand-written per architecture, benchmarked
publicly, worth billions in aggregate) is already visible in FlashAttention, cuBLAS, and CUTLASS.

## 3.4 Audio / perceptual coding, in a paragraph

Audio codecs (MP3, AAC, Vorbis, Opus) use the **MDCT** — a lapped transform with 50% overlapping
windows, which cancels the boundary artefacts that plague the block DCT (time-domain alias
cancellation) and so avoids audible clicks at block boundaries. The quantisation step sizes come
from a **psychoacoustic model** built on two facts: *simultaneous masking* — a loud tone at 1 kHz
makes quieter tones at nearby frequencies literally inaudible, so you can quantise them to nothing
— and *temporal masking*, where a loud transient masks sound for a few milliseconds before and
~100 ms after it. The encoder computes a masking threshold per critical band per frame and
allocates bits so that quantisation noise stays *just under* the threshold: the noise is not small,
it is **hidden**. Window switching (long windows for steady tones, short for transients) prevents
"pre-echo", where a cymbal's quantisation noise spreads backwards across a long window and is heard
before the cymbal. Opus additionally merges a speech codec (SILK, linear prediction) with a music
codec (CELT, MDCT) and switches or blends between them, which is why one codec covers 6 kbit/s
voice and 256 kbit/s stereo music, and why it is in WebRTC, Discord, and every browser.

## 3.5 ★ Neural network quantisation is lossy compression — the same three steps

This is the connection the curriculum needs to make explicitly, because the FP4/block-scaling
material downstream is *exactly* a transform-quantise-entropy-code scheme with two of the three
steps renamed and the third sometimes omitted.

### The mapping, line by line

| lossy codec step | JPEG | NN quantisation |
|---|---|---|
| **Transform** — decorrelate, concentrate energy | 8×8 DCT | often **identity**; or a **random Hadamard rotation** (QuaRot / QuIP# / the NVFP4 recipe) to spread outliers; or a learned rotation |
| **Quantise** — the lossy step | divide by `Q(u,v)`, round | divide by a **scale**, round to E2M1 / INT4 / E4M3 |
| **Step size selection** — the perceptual model | Annex K tables, tuned to the human visual system | per-tensor / per-channel / **per-block amax**, tuned to *the loss* |
| **Entropy code** | zigzag + RLE + Huffman | usually **omitted** — weights must be randomly addressable and decoded at GEMM speed |
| **Block structure** | 8×8 pixels | **16 or 32 elements** (NVFP4 / MXFP4) |
| **Per-block side info** | none (global table) | the **block scale** (UE4M3 or UE8M0), 1 value per 16–32 |
| **What "quality" means** | PSNR / SSIM / an eye | perplexity delta, or downstream task accuracy |
| **Quality knob** | quality factor 1–100 | bits per weight: 16 → 8 → 6 → 4 → 2 |

### The three points to make out loud

**(1) A block scale *is* a quantisation table entry.** JPEG divides the 8×8 block's coefficients by
a per-coefficient step size before rounding. MXFP4 divides a 32-element block by a per-block scale
before rounding to 4 bits. Both are "pick a step size so the values land inside the format's
range". The only difference is that JPEG's step sizes are *fixed by the standard and tuned to human
vision*, and a block scale is *computed per block from the data*. In JPEG terms, block scaling is a
per-block adaptive quantisation table — an idea JPEG could have used and didn't, because
transmitting a table per block was too expensive in 1992 and is trivially cheap when the "table" is
one 8-bit exponent per 32 values.

**Verified, §7.6:** the same three-line quantiser applied to a block of 16 normally-distributed
weights, scaled so the block max lands on E2M1's maximum of 6.0, achieved **26.50 dB SQNR**; the
same block with one value inflated 12× fell to **22.25 dB**. That is the outlier problem, measured,
in the same program as the JPEG quality sweep — which is the point.

**(2) Outliers are the whole difficulty, and the fix is a transform.** In JPEG, a sharp edge puts
energy into every frequency and produces ringing. In a weight or activation tensor, one outlier
channel forces a large block scale and crushes the other 15 values into a handful of levels. Both
are "the transform failed to concentrate the energy". And both have the same fix: **change basis
first.** JPEG uses the DCT; QuaRot/QuIP#/NVFP4 use a **random Hadamard transform**, chosen because
`A·H·(Bᵀ·H)ᵀ = A·B` exactly — the rotation is mathematically free and numerically enormous — and
because the fast Walsh–Hadamard transform costs `O(n log n)` **additions and no multiplies**, which
is the same reason JPEG chose the DCT over the KLT: the optimal transform is unaffordable, the
nearly-optimal one has a fast algorithm.

**(3) The entropy-coding step is deliberately dropped, and knowing *why* is the insight.** JPEG
entropy-codes because the decoder reads sequentially and only needs to be fast enough for a
display. Quantised weights are read by a **tensor core**, randomly addressed, at terabytes per
second — an entropy coder in that path would be catastrophic. So NN quantisation stops after step
2 and accepts a fixed-rate code. This is exactly the *fixed-rate vs variable-rate* trade every
codec designer knows: fixed-rate loses ratio and buys random access. It is the same reason
filesystems compress in fixed-size blocks (§2.12) and the same reason GPU texture compression
formats (BC/ASTC) are fixed-rate — a texture unit must fetch texel `(u,v)` in constant time.

Once a student sees that, the entire FP4/MX/NVFP4 body of work stops being GPU trivia and becomes
what it is: **lossy compression with a very unusual decoder, and a very unusual fidelity metric.**
And the fidelity metric is the interesting part — "what does the loss landscape notice" is a
genuinely open perceptual-model question, exactly as "what does the eye notice" was in 1992.

Cross-reference: `fp4-fp8-blackwell.md` §1–§3 covers the formats, block scaling, stochastic
rounding and the Hadamard transform in full. This section is the *frame* that makes it legible;
that document is the detail.

---

# 4. Error Detection and Correction

## 4.1 The geometry: distance, spheres, and what a code *is*

A **code** is a subset `C ⊆ {0,1}ⁿ` of the `2ⁿ` possible `n`-bit strings. The elements of `C` are
**codewords**; everything else is invalid. Encoding maps `k` data bits into one of `2ᵏ` codewords;
the code has **rate** `R = k/n`.

**Hamming distance** `d(x,y)` = the number of positions where `x` and `y` differ. **Hamming weight**
`w(x) = d(x, 0)` = the number of ones.

**Minimum distance** `d_min` = the smallest distance between any two distinct codewords. This one
number determines everything the code can do:

```
    detect up to    d_min − 1        errors
    correct up to  ⌊(d_min − 1)/2⌋   errors
```

The geometric picture, which is the one to teach:

```
    Imagine each codeword as the centre of a sphere of radius t in
    Hamming space. If the spheres don't overlap, every received word
    is unambiguously closest to exactly one codeword.

        ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·
        ·  ( C₁ )     ·      ( C₂ )   ·      d(C₁,C₂) = 5
        ·   \_t=2_/   ·       \_t=2_/  ·      t = 2, spheres disjoint
        ·  ·  ·  ·  ·  ·  ·  ·  ·  ·  ·      → corrects 2 errors
```

To *detect* `e` errors you only need the corrupted word to fall outside every sphere of radius 0 —
i.e. to not be another codeword — so `d_min > e`. To *correct* `t` errors you need the corrupted
word to still be closest to the original, so `d_min > 2t`. Hence the two formulas, and hence the
constant tension: bigger `d_min` costs rate.

**Verified, §7.7:** Hamming(7,4) has `d_min = 3` exactly (computed over all 120 codeword pairs),
therefore corrects 1 and detects 2 — and, as predicted, all 336 possible double-bit errors are
*silently decoded to the wrong word*.

**Singleton bound:** `d_min ≤ n − k + 1`. Codes meeting it with equality are **MDS** (Maximum
Distance Separable) — you cannot do better with those parameters. **Reed–Solomon codes are MDS**,
which is precisely why they dominate erasure coding (§4.5).

**Systematic** codes keep the data bits verbatim inside the codeword and append parity. This is
almost always what you want: the read path with no errors needs no decoding at all.

## 4.2 Parity and checksums

**Single parity bit.** Append one bit making the total weight even. `d_min = 2`. Detects any odd
number of errors, corrects nothing, misses all even numbers of errors. Cost: 1 bit. Still used
where it's nearly free — the classic 9th bit on old parity DRAM, UART parity, some cache
tag arrays.

**Two-dimensional parity.** Arrange the data in a rectangle, add a parity bit per row and per
column. Now a single-bit error is located by the intersection of the failing row and failing
column, so it is *correctable*. This is a nice teaching device (it makes "syndrome = coordinates"
obvious) and it is also, structurally, what RAID-6-style row/diagonal parity schemes do.

**Checksums** — the family that trades detection power for speed:

| scheme | strength | where |
|---|---|---|
| sum of bytes mod 256 | very weak; misses transpositions and any pair of compensating errors | toy protocols, some firmware |
| **Internet checksum** (RFC 1071) — one's-complement sum of 16-bit words | weak: **misses all transpositions of 16-bit words**, misses many 2-bit patterns | IPv4 header, TCP, UDP, ICMP |
| **Fletcher / Adler-32** | positional (two running sums), much better than a plain sum, still weaker than CRC | Adler-32 in zlib's *gzip wrapper*; Fletcher in some filesystems |
| **CRC-32** | all bursts ≤ 32 bits, all 1- and 2-bit errors within 4 Gbit | Ethernet, PCIe, SATA, PNG, gzip, ext4 metadata |
| **xxHash / crc32c hardware** | not error-detection-optimal, but ~10–50 GB/s | ZFS, btrfs, zstd frames, RocksDB |
| **cryptographic hash** | detects adversarial modification | git, IPFS, TLS, secure boot |

The Internet checksum is a genuinely instructive piece of history: it was chosen in 1981 because it
could be computed on a PDP-11 in a few instructions per word, and it is *weak*. It cannot detect a
swap of two 16-bit words, and it cannot detect an error in one word compensated by an opposite
error in another. It survives only because it is the innermost of several layers — Ethernet's
CRC-32 below it and TLS's MAC above it are doing the real work — and because changing it is
impossible. When TCP checksum failures *do* slip through, they are usually caused by hardware
between the two CRC-protected hops (a bad router memory, a buggy NIC offload), which is exactly the
gap the end-to-end argument predicts.

## 4.3 CRC — polynomial division, done properly

CRC is the workhorse: cheap in hardware (a shift register and some XOR gates), cheap in software
(a table lookup per byte, or one `crc32` instruction per 8 bytes on x86-64/ARM), and with
*provable* guarantees rather than statistical hand-waving.

### The mathematics

Treat a message `m₀ m₁ … m_{k−1}` as a polynomial over **GF(2)** — the field with two elements,
where addition is XOR and there are no carries:

```
    M(x) = m₀x^{k−1} + m₁x^{k−2} + … + m_{k−1}
```

Pick a **generator polynomial** `G(x)` of degree `r`. The CRC is the remainder:

```
    CRC = ( M(x) · x^r )  mod  G(x)
```

and the transmitted codeword is `M(x)·x^r + CRC`, which is by construction **exactly divisible by
`G(x)`**. The receiver divides by `G(x)` and expects zero.

Multiplying by `x^r` is shifting left `r` bits — that is why the CRC appends to the message and
leaves the data untouched: CRC is a *systematic* code.

### Why the guarantees hold

The received word is `T(x) + E(x)` where `E(x)` is the error pattern. Since `G | T`, the syndrome
is `E mod G`. So:

> **An error is undetected if and only if `G(x)` divides `E(x)`.**

That single line generates every CRC property, and the derivations are short enough to do on a
whiteboard:

**All single-bit errors.** `E(x) = x^i`. If `G` has at least two nonzero terms, it cannot divide a
monomial. Every real CRC polynomial has at least two terms. ✔

**All burst errors of length ≤ r.** A burst confined to `L ≤ r` consecutive bits is
`E(x) = x^i · B(x)` with `deg B < r` and `B ≠ 0`. `G(x)` has a nonzero constant term (all standard
ones do), so `gcd(G, x^i) = 1`, so `G | E` requires `G | B` — impossible, since `deg B < deg G` and
`B ≠ 0`. ✔ **This is the burst-error property, and it is a proof, not a probability.**

**Verified, §7.2:** 127,096 messages corrupted with random bursts of every length 1–32 at every
starting offset in a 64-byte message. **Undetected: 0.** Then 960,000 bursts of length 33: also 0
observed, consistent with the theoretical undetected rate of `2⁻³¹ ≈ 4.7×10⁻¹⁰` (expected ~0.0004
occurrences in that sample).

Longer bursts are detected with probability `1 − 2⁻ʳ` — for CRC-32, `1 − 2⁻³²`, i.e. 99.99999998%.

**Two-bit errors.** `E(x) = x^i + x^j = x^i(1 + x^{j−i})`. Undetected iff `G | (x^{j−i} + 1)`, i.e.
iff `j − i` is a multiple of the **multiplicative order of `x` modulo `G`**. So the guarantee is
exactly: *no two-bit error whose two bits are less than `ord(x)` apart is ever missed.*
**Verified, §7.2:**

```
   CRC-32/ISO-HDLC  0x04C11DB7 :  ord(x) = 4294967295 = 2³² − 1   (G is PRIMITIVE)
   CRC-32C          0x1EDC6F41 :  ord(x) = 2147483647 = 2³¹ − 1
   CRC-16/CCITT     0x1021     :  ord(x) = 32767      = 2¹⁵ − 1
```

So CRC-32 misses no 2-bit error within 4 *gigabits*. A 1500-byte Ethernet frame is 12,000 bits.
There is enormous margin.

**Odd numbers of errors — and the folklore correction.** All odd-weight errors are detected **iff
`(x+1) | G(x)`**, because `E(1) = 1` for odd-weight `E`, so `G(1) = 0` would force `G ∤ E`.
And `G(1) = 0` over GF(2) means `G` has an **even number of nonzero terms**. **Verified, §7.2:**

```
   CRC-32/ISO-HDLC  0x04C11DB7 : 15 terms → G(1)=1 → (x+1) does NOT divide → odd-weight NOT guaranteed
   CRC-32C          0x1EDC6F41 : 18 terms → G(1)=0 → (x+1) DOES divide     → all odd-weight detected
   CRC-16/CCITT     0x1021     :  4 terms → G(1)=0 → (x+1) DOES divide     → all odd-weight detected
```

**The Ethernet CRC-32 does not detect all odd-weight errors.** This contradicts a claim repeated in
a great many textbooks and blog posts, and the check takes one popcount. It is a primitive
polynomial of degree 32 instead, which buys the enormous 2-bit span above but gives up the
odd-weight guarantee. Castagnoli's CRC-32C was *designed* with the `(x+1)` factor and consequently
achieves `d_min = 6` up to ~5.2 Kbit where CRC-32 achieves only 4 beyond ~91.6 Kbit
*(the specific length thresholds are Koopman's, recalled — see §8; the `(x+1)` and `ord(x)` facts
above are verified here).*

Make the student run this check. "Verify the folklore, find it wrong" is worth more than any
amount of being told.

### Implementation

**Bitwise:** shift and conditionally XOR, 8 iterations per byte.
**Table-driven** (Sarwate, 1988): precompute a 256-entry table of the CRC of each byte; then
`crc = table[(crc ^ byte) & 0xFF] ^ (crc >> 8)`. One lookup and two XORs per byte.
**Slicing-by-8/16:** process 8 or 16 bytes at a time with parallel tables.
**Hardware:** x86-64 `crc32` (SSE4.2) does CRC-32**C** — note, not CRC-32 — 8 bytes per
instruction. ARMv8 has `crc32*` and `crc32c*`. For CRC-32 proper, `PCLMULQDQ`-based carryless
multiplication folds 16 bytes at a time and is what zlib-ng and Intel's ISA-L use.

**The conventions that will confuse everyone once.** "CRC-32" in the wild means: reflected input
and output bits (LSB-first, because that's the order bits go on the wire), initial value
`0xFFFFFFFF`, final XOR `0xFFFFFFFF`. The init and final-XOR exist so that leading zeros change the
CRC (without them, `0x0000ABCD` and `0xABCD` have the same CRC) and so that a trailing run of zeros
is detected. The reflected polynomial `0xEDB88320` is the bit-reversal of `0x04C11DB7` and is what
appears in almost all software. **Verified, §7.2:** all three of a bitwise implementation, a
table-driven implementation, and zlib's `crc32()` produce `0xCBF43926` for `"123456789"` — the
universal check value — and `0xE3069283` for CRC-32C, `0x00000000` for the empty string, and
`0xE8B7BE43` for `"a"`.

### Where CRC is used, and the layer it defends

| system | CRC | protects |
|---|---|---|
| Ethernet (802.3) | CRC-32, poly `0x04C11DB7` | the frame, checked in NIC hardware; failures are dropped silently and counted |
| PCIe | CRC-32 (LCRC, per TLP) + CRC-16 (per DLLP) | **with automatic retry** — a failed TLP is retransmitted by the link layer |
| SATA / SAS | CRC-32 | the frame |
| USB | CRC-5 (token), CRC-16 (data) | small packets |
| NVMe / T10-DIF/PI | CRC-16 (T10) or CRC-32C | end-to-end per 512B/4KB block, host to media |
| gzip, PNG | CRC-32 | the decompressed stream / each chunk |
| ext4 | CRC-32C | metadata and the journal (not file data) |
| Btrfs, ZFS | CRC-32C / xxHash / Fletcher / SHA-256 | **every block, data and metadata** |
| iSCSI, SCTP | CRC-32C | the PDU |
| CAN bus | CRC-15 | the automotive frame |

Note the layering: an Ethernet frame that traverses three switches is CRC-checked and
**re-generated** at every hop. A bit flipped inside a switch's memory between check and regenerate
is invisible to Ethernet — which is precisely the end-to-end argument, and precisely why TCP has
its own (weak) checksum and TLS has a (strong) MAC.

## 4.4 Hamming codes and SECDED

Richard Hamming, Bell Labs, ~1947, published 1950. The origin story is the best in the field: he
had weekend access to a relay computer that would halt on a parity error, and he came in on Mondays
to find his jobs dead. *"If it can detect the error, why can't it correct it?"*

### The construction

Put the bits at positions `1..n`. Parity bits go at the **powers of two** (1, 2, 4, 8, …); data bits
fill everything else. Parity bit at position `2ʲ` covers every position whose binary representation
has bit `j` set.

For Hamming(7,4): parity at 1, 2, 4; data at 3, 5, 6, 7.

```
   position:   1    2    3    4    5    6    7
               p1   p2   d1   p4   d2   d3   d4
   p1 covers:  1         3         5         7      (bit 0 set)
   p2 covers:       2    3              6    7      (bit 1 set)
   p4 covers:                 4    5    6    7      (bit 2 set)
```

### Why the syndrome is the answer

Compute the three parity checks at the receiver. Call the results `s1 s2 s4`. If a single bit at
position `p` flipped, then check `sⱼ` fails exactly when position `p` has bit `j` set — which means
**the syndrome, read as a binary number, is `p` itself.** Zero syndrome means no error. That is the
entire decoder: compute three XORs, read the answer as an integer, flip that bit.

**Verified exhaustively, §7.7:** over all 16 data words × 7 flip positions = **112 cases**, the
syndrome equalled the flipped position every time and the decoder recovered the original data
**112/112**.

This is not just elegant, it is *optimal*: a perfect code. `2ᵏ` codewords × `(n+1)` words per sphere
(the codeword plus `n` single-flip neighbours) `= 16 × 8 = 128 = 2⁷`. The spheres tile the space
exactly with nothing left over. Hamming codes exist for every `n = 2ᵐ − 1`, `k = 2ᵐ − m − 1`:
(7,4), (15,11), (31,26), (63,57), (127,120) — rate improves as blocks get longer, which is why real
memory ECC uses long blocks.

### SECDED — the +1 that matters

Hamming(7,4) has `d_min = 3`. A **double** error produces a nonzero syndrome pointing at some
innocent third bit, which the decoder dutifully flips — turning 2 errors into 3 and silently
producing wrong data. **Verified, §7.7: all 336 double-bit error patterns are silently mis-decoded.**
Silent corruption is worse than a crash, which is the whole motivation for the fix.

Add **one overall parity bit** over the entire codeword. Now `d_min = 4`, **verified**, and the
decoder has three cases:

```
    syndrome = 0, overall parity OK    →  no error
    syndrome ≠ 0, overall parity WRONG →  single error at position=syndrome; CORRECT it
    syndrome ≠ 0, overall parity OK    →  DOUBLE error; DETECTED, uncorrectable → report it
    syndrome = 0, overall parity WRONG →  the overall parity bit itself flipped
```

**SECDED**: Single Error Correct, Double Error Detect. **Verified, §7.7:** all 448 double-error
patterns in the (8,4) code are correctly flagged as uncorrectable rather than silently mis-fixed.

**This is what ECC DRAM does**, at (72,64): 64 data bits plus 8 check bits per transfer — one extra
×8 DRAM chip per rank, which is why an ECC DIMM has 9 (or 18) chips where a non-ECC one has 8 (or
16), and why ECC DIMMs cost about 12.5% more in silicon. Real implementations use a Hsiao code
rather than textbook Hamming — same parameters, but the parity-check matrix is chosen with odd,
balanced column weights, which minimises XOR-tree depth (faster) and improves the detection of
some multi-bit patterns.

## 4.5 Reed–Solomon — oversampling a polynomial

Reed and Solomon, 1960. The most consequential code in the document: it is in CDs, DVDs, QR codes,
DSL, digital TV, deep-space probes, RAID-6, and every distributed object store.

### The idea, in one sentence

**Two points determine a line. If you send five points on that line, any two survivors reconstruct
it.** Reed–Solomon is that, with degree `k−1` polynomials over a finite field.

```
   k data symbols  =  the k coefficients of a polynomial P of degree k−1
   n codeword symbols = P evaluated at n distinct points α₁ … αₙ

   Any k of the n evaluations determine P uniquely (Lagrange interpolation).
   So you can lose any n − k of them.
```

That is the entire code. It is MDS — it meets the Singleton bound `d_min = n − k + 1` with equality
— because two distinct degree-`(k−1)` polynomials agree in at most `k−1` places, so two codewords
differ in at least `n − k + 1` places. **You cannot do better.** Nothing tolerates more losses for
the same overhead. That optimality is why RS is everywhere.

### The field

Symbols are elements of **GF(2^m)**, almost always **GF(2⁸) = bytes**, with arithmetic modulo a
primitive polynomial (commonly `0x11D` = `x⁸+x⁴+x³+x²+1`; AES uses `0x11B` instead, and mixing them
up produces wrong answers that look plausible). Addition is XOR; multiplication is done with
log/antilog tables, `a·b = exp(log a + log b)`. Working over a *field* is what makes interpolation
and matrix inversion always work.

Using bytes as symbols has a lovely side effect: **a burst of up to 8 consecutive bit errors damages
at most 2 symbols**, so a code that corrects `t` symbol errors corrects bursts of about `8t` bits.
RS is naturally a burst-error code, which is why it is used on physical media where scratches and
dropouts are the failure mode.

### Erasure vs error decoding

- **Erasure** (you know *which* symbols are missing): recover from any `n−k` losses. Just
  interpolate. Linear algebra, cheap.
- **Error** (you don't know which are wrong): correct up to `⌊(n−k)/2⌋`. You spend two symbols per
  unknown-location error — one to find it, one to fix it. Needs syndromes,
  Berlekamp–Massey or Euclidean decoding, Chien search, and Forney's algorithm.

Knowing the location is worth exactly a factor of two, and that is why storage systems work
hard to *turn errors into erasures*: a disk that fails loudly is twice as cheap to tolerate as one
that returns wrong data quietly. This is the coding-theory reason that "fail-stop" is a design
goal.

**Verified, §7.8:** with `k=4`, `n=8` over GF(256), the original data was recovered from
**all 70 of the possible 4-of-8 survivor sets** — every one, exhaustively. With only `k−1 = 3`
shards, recovery correctly fails. A systematic Cauchy-matrix version with `k=6, m=3` recovered from
**all 84 of the 6-of-9 survivor sets, with zero singular matrices** — that is RAID-6-shaped, only
more so.

### Systematic construction, as used in practice

Real erasure coders use a generator matrix `G = [I ; V]` where `I` is `k×k` identity (so the data
shards are stored verbatim — no decode cost on the happy path) and `V` is a `m×k` matrix whose every
square submatrix is invertible. **Cauchy matrices** (`A[i][j] = 1/(xᵢ ⊕ yⱼ)` with disjoint `x`, `y`
sets) have that property by construction and are what Jerasure and most libraries use; naïve
Vandermonde-over-identity does *not* always work, and the bug is subtle enough that it bit real
implementations. To reconstruct, take the `k` surviving rows, invert that `k×k` matrix, multiply.
Verified above with zero singular cases across all 84 subsets.

### Where you meet it

| system | parameters | notes |
|---|---|---|
| **Audio CD (CIRC)** | two interleaved RS codes, RS(32,28) and RS(28,24) over GF(256) | cross-interleaving spreads a scratch across many codewords; corrects bursts of ~4000 bits ≈ **2.5 mm of physical damage** |
| **DVD / Blu-ray** | RS product codes | same idea, longer blocks |
| **QR codes** | RS over GF(256), 4 levels L/M/Q/H | level H tolerates ~30% of the symbols being destroyed, which is why you can put a logo in the middle |
| **RAID-6** | RS with `m=2` (P and Q syndromes) | survives any 2 simultaneous drive failures |
| **Erasure coding in object stores** | RS(10,4), RS(12,4), RS(9,6)… | HDFS-EC, Ceph, MinIO, Backblaze, S3-class systems |
| **Deep space (Voyager, CCSDS)** | RS(255,223) concatenated with a convolutional code | the RS outer code cleans up the burst errors the Viterbi inner decoder makes |
| **DSL, DVB, ATSC, WiMAX** | RS(255,239) and friends | the classic outer code |

### Why erasure coding replaced 3× replication

For a distributed store, `RS(k, m)` gives `(k+m)/k` storage overhead and tolerates any `m` failures.

```
   3× replication:  3.00× overhead, tolerates 2 losses
   RS(6, 3):        1.50× overhead, tolerates 3 losses   ← better on BOTH axes
   RS(10, 4):       1.40× overhead, tolerates 4 losses
   RS(12, 4):       1.33× overhead, tolerates 4 losses
```

**Half the storage, more durability.** At exabyte scale that is a very large number of dollars, and
it is why every large object store moved. What you pay instead:

- **Repair traffic.** Losing one shard in RS(10,4) requires reading **10 shards** to rebuild it; a
  replica system reads 1. Repair bandwidth dominates cluster networking, and it is the reason
  Local Reconstruction Codes (Microsoft Azure's LRC) and regenerating codes exist — they add a
  little overhead to make the common single-failure repair cheap and local.
- **Latency and CPU on the read path** when a shard *is* missing.
- **Small-object inefficiency.** A 1 KB object split into 10 shards is 10 tiny I/Os. Erasure coding
  wants large objects, which is why these systems aggregate small objects into big "stripes" first.

## 4.6 LDPC and turbo codes — reaching capacity

Shannon promised in 1948 that capacity was reachable. It took 45 years.

**Turbo codes** (Berrou, Glavieux, Thitimajshima, 1993) were the shock: two simple convolutional
encoders separated by an interleaver, decoded by two soft-decision decoders that **exchange
probabilistic beliefs iteratively** — each decoder's output becomes the other's prior, round and
round, hence "turbo". Performance within ~0.5 dB of the Shannon limit, from a scheme the
establishment initially disbelieved. They went into 3G and 4G (UMTS, LTE) and deep-space CCSDS
standards.

**LDPC codes** (Gallager, 1962 PhD thesis) are codes with a *sparse* parity-check matrix `H` —
each check involves only a handful of bits. Decoding is **belief propagation** on the bipartite
graph of variable nodes (bits) and check nodes (parity constraints): each node passes
log-likelihood ratios to its neighbours, iterating 10–50 times until the checks are satisfied.

```
    variable nodes (bits)      check nodes (parity equations)
         v1 ────────────────────── c1
         v2 ──┬───────────────────/
         v3 ──┘   ┌────────────── c2
         v4 ──────┘  ┌─────────── c3
         v5 ─────────┘

    sparse graph → each message is cheap → many iterations are affordable
```

Gallager's codes were **ignored for thirty years** because the decoder was unaffordable on 1962
hardware, and were rediscovered by MacKay and Neal in 1996 after turbo codes made iterative
decoding respectable. They are now the default: within ~0.1 dB of capacity, and — crucially —
**massively parallel**, since every variable node's message computation is independent. That
parallelism is why LDPC beat turbo codes for high-throughput applications: a turbo decoder is
inherently more serial.

Where they are:

| standard | code |
|---|---|
| Wi-Fi 802.11n/ac/ax/be | LDPC (optional in n, standard practice since) |
| 5G NR **data** channels | **LDPC** |
| 5G NR **control** channels | **polar codes** (Arıkan 2009 — the first codes *proved* to achieve capacity) |
| 4G LTE | turbo |
| DVB-S2/T2/C2 | LDPC + BCH outer |
| 10GBASE-T Ethernet | LDPC |
| **NAND flash (modern TLC/QLC)** | **LDPC**, replacing BCH |
| Deep space (CCSDS) | LDPC and turbo |

### LDPC in NAND flash is the one that matters for the storage track

This deserves its own paragraph because it explains modern SSD behaviour.

A flash cell stores charge; the controller reads it by comparing against threshold voltages. SLC
has 2 levels, MLC 4, TLC 8, **QLC 16** — sixteen distinguishable charge levels in a cell that leaks,
that is disturbed by neighbouring reads and writes, and that wears out. Raw bit error rates on QLC
are **appalling**, on the order of 10⁻³ to 10⁻², and must be delivered to the host at 10⁻¹⁵.

BCH codes (the older choice) are **hard-decision**: they take a bit and correct it.
LDPC is **soft-decision**: it takes a *likelihood* and reasons probabilistically. That is worth
1–2 dB, which is worth years of extra flash endurance, which is worth the entire QLC product
category. Without LDPC there is no QLC, and without QLC there are no cheap high-capacity SSDs.

Modern SSD controllers do a **tiered read**:
1. Fast hard-decision LDPC pass on the default threshold. Usually succeeds, microseconds.
2. On failure, **re-read at shifted threshold voltages** to get soft information (how close was
   the cell to the boundary?). Slower.
3. More soft reads, more decoder iterations, sometimes RAID-like parity across dies
   ("RAIN"/"redundant array of independent NAND").
4. Give up → uncorrectable read error → the host sees a media error.

**This is why SSD read latency has a long tail, and why it gets worse as the drive ages.** A
tail-latency investigation that ends at "the LDPC decoder needed three soft-read retries" is a real
one. It is also why drives slow down near end-of-life rather than failing cleanly, and why
`smartctl` reports a "raw read error rate" that is nonzero on a perfectly healthy drive — the ECC
is *supposed* to be working hard.

## 4.7 ECC memory — how it works and who gets it

### The mechanism

A DDR4/DDR5 rank delivers **64 bits** per transfer to the memory controller. An **ECC DIMM** is 72
bits wide: 64 data + 8 check bits, from one extra ×8 chip. The memory controller runs a **(72,64)
SECDED** code (§4.4) — in practice a Hsiao code rather than textbook Hamming, chosen for shallower
XOR trees and better multi-bit behaviour.

On every read: recompute the check bits, compare, and

- syndrome 0 → deliver the data;
- syndrome indicates a correctable single-bit error → **fix it, deliver correct data, log a CE**
  (correctable error) via the machine-check architecture;
- syndrome indicates a detected-uncorrectable error → **do not deliver garbage.** Raise a
  machine-check exception. Linux's EDAC/MCE path may kill only the owning process (via
  `memory_failure()` / `SIGBUS` with `BUS_MCEERR_AR`) if the page can be isolated, or panic.

The Linux kernel's EDAC subsystem is the reporting layer, and its own documentation defines the
terms exactly: a **Corrected Error (CE)** *"indicates that an ECC corrected error was detected"*,
while an **Uncorrected Error (UE)** *"indicates an error that can't be corrected by ECC, but it is
not fatal"* — plus fatal and deferred variants. EDAC models memory as
**memory controller → chip-select row (csrow) → channel**, which is how you get from an MCE to
"DIMM in slot A2".

The operational value of CEs is that they are a **leading indicator**. A DIMM logging a rising
count of corrected errors is a DIMM that is about to produce an uncorrectable one. Every serious
fleet alerts on CE rate and replaces the module before it kills a job. `rasdaemon` /
`edac-util` / `mcelog` exist for this.

### Beyond SECDED

- **Chipkill / SDDC (Single Device Data Correction)** — IBM's name; Intel's SDDC; AMD's Chipkill.
  Survives the failure of an **entire DRAM chip**, not just a bit. Done by interleaving a symbol-
  based code (RS or a `b`-adjacent code) across chips so that one chip contributes at most one
  symbol per codeword. Needs a wider access (e.g. 128 data + 16 check bits) and is standard on
  server platforms.
- **Memory scrubbing (patrol scrub)** — a background engine walks all of memory, reads it, and
  writes back corrected data. Without it, single-bit errors *accumulate* over months until a second
  hits the same word and becomes uncorrectable. Scrubbing converts a growing latent-fault
  population into corrected errors. This is exactly the same argument as a ZFS scrub or a RAID
  patrol read, one level down.
- **Memory mirroring / rank sparing** — full redundancy or hot-spare ranks, for people who
  really cannot lose the machine.
- **Link/bus CRC** — DDR4 added CRC on *write* data across the bus; that protects the wires, not
  the cells, and is a separate mechanism from the array ECC.

### Why servers have it and desktops mostly don't

The technical case for ECC everywhere is overwhelming. Google's large-scale field study of its
fleet (Schroeder, Pinheiro & Weber, SIGMETRICS 2009) found:

- **25,000 to 70,000 errors per billion device-hours per Mbit** — orders of magnitude above the
  vendor estimates then in circulation;
- **more than 8% of DIMMs affected by errors per year**;
- errors **dominated by hard (repeatable, device-related) errors rather than soft (cosmic-ray)
  errors** — which overturned the received wisdom and is why "just add ECC" is not the whole answer
  (a hard fault will keep hitting the same bit until the DIMM is replaced);
- and, notably, **temperature had a surprisingly small effect** in the field once other factors
  were controlled.

Later work (Meza, Wu, Kumar & Mutlu, DSN 2015, on Facebook's fleet) confirmed the shape and added
that error rates rise sharply with density and with utilisation.

So why don't desktops have ECC? The honest answer is **market segmentation**, plus three real
costs:

1. ~12.5% more DRAM chips, plus a wider bus.
2. A small latency and power cost for encode/decode in the memory controller.
3. Historically, Intel disabled ECC support on consumer chipsets to differentiate Xeon. AMD's
   Ryzen has *unofficially* supported unbuffered ECC on many boards, which is a decent natural
   experiment showing the silicon cost is not the barrier.

The consequence for a workstation user is that a corrupted photo, a corrupted compile, or a
corrupted git object is silent. For a developer machine that is annoying; for a build farm or a
training cluster it is unacceptable, and that is why every server and every accelerator has it.

## 4.8 Rowhammer, and why ECC was not enough

### The bug

Kim et al., ISCA 2014, *"Flipping Bits in Memory Without Accessing Them"*. DRAM cells are packed so
tightly that **repeatedly activating one row causes charge to leak from cells in physically adjacent
rows**. Hammer a row tens of thousands of times within one refresh interval (64 ms) and bits flip in
its neighbours. No privilege required; it is a physics bug reachable from unprivileged code.

```
        row N−1   ← victim: bits flip here
        row N     ← aggressor: activated over and over
        row N+1   ← victim: bits flip here
```

This is not a rare defect. Kim et al. found flips on a large majority of the DDR3 modules they
tested, from all three major vendors.

### Weaponisation

Google Project Zero (2015) turned it into privilege escalation two ways: flipping a bit in a **page
table entry** to gain write access to a page table (hence to all of physical memory), and escaping
the NaCl sandbox. Then it got worse and much more general:

- **Rowhammer.js** (2015) — from JavaScript in a browser, no native code.
- **Drammer** (2016) — deterministic exploitation on Android via the ION allocator.
- **Throwhammer / Nethammer** (2018) — triggered by *network packets* over RDMA or high-rate
  traffic, with no attacker code on the machine at all.
- **GLitch** (2018) — from the GPU, via WebGL.
- **TRRespass** (2020) — defeated **TRR** (Target Row Refresh), the in-DRAM mitigation vendors had
  shipped as the answer, by hammering *many* rows so the tracker's limited state overflowed.
- **Half-Double** (Google, 2021) — the effect reaches **two rows away**, not just adjacent ones,
  breaking mitigations built on the assumption of strict adjacency.
- **Blacksmith** (2021) — non-uniform, frequency-varied hammering patterns that defeat the
  refreshed TRR implementations.

### Why ECC did not save us

The intuitive argument is "SECDED corrects single-bit flips, and Rowhammer flips single bits, so
ECC fixes it." **ECCploit** (Cojocar et al., IEEE S&P 2019, VUSec) demolished it. From their
write-up:

- ECC corrects one flip per word and detects two. *"Only if you have three bitflips in the right
  places, will you be able to bypass ECC."* And with enough hammering, three flips in one ECC word
  are achievable.
- Getting there requires knowing which bits to flip, which requires knowing the (undocumented,
  vendor-specific) ECC function. The researchers reverse-engineered it on Intel Haswell and Sandy
  Bridge Xeons and AMD Opterons.
- The enabler is a **timing side channel**: *"it will typically take measurably longer to read from a
  memory location where a bitflip needs to be corrected, than it takes to read from an address where
  no correction was needed."* The difference was up to **1000×** on some systems. So the attacker
  can *probe* which single-bit flips are correctable — ECC's own correction becomes an oracle
  telling the attacker exactly which bits are flippable. Assigned **CVE-2018-18904**.
- Cost: about **32 minutes** to find exploitable flips when the side channel is directly
  observable, up to **a week** in noisy conditions.

The lesson, and it is a general one worth stating carefully:

> **ECC is a code designed for a random, memoryless error process. Rowhammer is an adversary.**
> A code's guarantees are stated over an *error model*, and an attacker who can choose the error
> pattern is outside that model. ECC raises the cost of Rowhammer by orders of magnitude — which is
> real and valuable — but it does not close it, and *treating a probabilistic guarantee as a
> security guarantee is a category error.*

The same sentence applies to CRCs (great against noise, worthless against an adversary — hence
MACs), to checksums in filesystems, and to hash functions (§5.2).

The actual mitigations that work are elsewhere: shorter refresh intervals (expensive in power and
bandwidth), TRR and its successors (repeatedly broken), **DDR5's Refresh Management (RFM)** and
per-row activation counting, physical isolation of sensitive pages, and — the direction the
industry has settled on — in-DRAM counters with a JEDEC-standardised host/DRAM protocol for
mitigation. It remains an active arms race, twelve years on.

## 4.9 On-die ECC in DDR5

DDR5 introduced **on-die ECC (OD-ECC)**, and it is widely misunderstood, so it is worth being
precise about what it is *not*.

- It is a **SEC (single-error-correcting) code applied inside the DRAM chip**, over an internal
  word (commonly cited as 128 data bits with 8 check bits per device), transparently on read.
- It exists because **at 1x-nm process nodes the raw single-bit fail rate is high enough that chips
  could not be sold without it**. It is a *manufacturing yield and reliability* measure, not a
  system-reliability feature. It protects the array; it does not protect the bus, the memory
  controller, the connectors, or anything else outside the die.
- **It is not system ECC.** It is present on *all* DDR5, including consumer UDIMMs and SODIMMs, and
  it does **not** make a non-ECC DDR5 module an ECC module. There is no reporting path: the host
  never learns that a correction happened. A machine with on-die ECC and no system ECC still
  delivers corrupted data to software when a fault escapes the on-die code.
- JEDEC also specifies **ECS (Error Check and Scrub)** in DDR5 — an in-DRAM scrubbing engine that
  walks the array, corrects with the on-die code, and can report error counts — which is the
  DRAM-internal analogue of the patrol scrub in §4.7.
- A real ECC DDR5 RDIMM adds the *system* level on top: extra devices for host-visible SECDED/SDDC
  with CE/UE reporting through EDAC.

Two second-order effects worth knowing: on-die ECC **changes Rowhammer's observable behaviour**
(single flips get corrected inside the chip, so the attacker sees a modified flip distribution —
this makes some research harder and some easier, and it is emphatically not a mitigation); and it
complicates error *attribution*, because a bit flip may be corrected invisibly at one layer and
reported at another.

*(Provenance note: JEDEC JESD79-5 itself is paywalled and was not read; the Micron white paper and
the Synopsys and Rambus write-ups were unreachable during this research — 404/403/bot-blocked. The
"128 data + 8 check bits" figure and the ECS details are vendor-consensus recalled from secondary
sources, and are flagged in §8. The architectural claim — that on-die ECC is not system ECC and
provides no host reporting — is uncontroversial and is stated by every vendor.)*

## 4.10 ★ ECC in HBM, and why it matters for long training runs

This is the section the AI-systems track needs, and the argument is quantitative.

### The setup

An H100 SXM has 80 GB of HBM3; an H200 has 141 GB of HBM3e; a B200 has 192 GB of HBM3e. HBM stacks
support ECC — on Nvidia datacentre parts, ECC is on by default and covers HBM, and the register
files, L1/L2 caches and shared memory have their own SECDED or parity protection. `nvidia-smi`
reports volatile and aggregate correctable/uncorrectable ECC error counts, and Nvidia's driver
supports **row remapping** on HBM3+: a row with a persistent fault is retired and replaced from a
spare pool, which is DRAM's version of a disk's reallocated-sector count.

### The arithmetic that makes it non-optional

Take the Google field study's figure: on the order of **25,000–70,000 errors per billion
device-hours per Mbit**. Even taking the low end, and even granting that HBM is a different
technology with different failure characteristics, scale it to a cluster:

```
   10,000 GPUs × 80 GB HBM  =  800 TB  =  6.4 × 10⁹ Mbit  (approximately)
   × 25,000 errors / 10⁹ device-hours / Mbit
   ≈ 1.6 × 10⁵ errors per hour, fleet-wide, before ECC
```

The absolute number should not be taken literally — HBM is not the DDR2/DDR3 of that study, the
error model is different, and the study's own point was that errors are dominated by a minority of
bad devices. But the **order of magnitude is the message**: at 10,000-GPU scale, memory errors are
not a rare event, they are a *rate*. A design that treats a bit flip as "shouldn't happen" is
wrong by many orders of magnitude.

### The measured version: Meta's Llama 3 405B run

We do not have to argue from estimates. Meta published the numbers, and they are the single best
citation for this whole point. From the Llama 3 paper (arXiv:2407.21783), §3.3.4, on a
**54-day pre-training snapshot on 16,384 H100s** (fetched and quoted):

> *"During a 54-day snapshot period of pre-training, we experienced a total of 466 job
> interruptions."*

Of those, **47 were planned** and **419 unexpected**. Approximately **78% of the unexpected
interruptions were confirmed hardware issues**, and GPU problems accounted for **58.7%** of all
unexpected issues. Broken out:

| cause | interruptions | share of unexpected |
|---|---|---|
| Faulty GPU | 148 | 30.1% |
| **GPU HBM3 memory** | **72** | **17.2%** |
| GPU SRAM memory | 19 | 4.5% |
| **Silent data corruption** | **6** | **1.4%** |

Read those rows carefully:

- **HBM3 memory faults alone caused 72 interruptions in 54 days** — more than one per day, on a
  cluster of 16k GPUs, *with ECC enabled and working*. These are the ones ECC could not correct or
  that required a node to be pulled. The correctable-error count, which is not in the table, will
  have been enormously larger.
- **Silent data corruption is its own line item**, six occurrences. SDC means the hardware produced
  wrong results and *did not say so* — no ECC error, no machine check, no crash. It is caught, if at
  all, by anomaly detection on the loss curve or by deliberate re-computation.
- Meta nonetheless kept **>90% effective training time** and needed **manual intervention only three
  times**, which is the other half of the lesson: the answer is not "prevent all faults", it is
  "detect fast, checkpoint well, restart automatically".

### Why a silent flip is worse than a crash

A crash costs you the time since the last checkpoint. **A silent flip costs you the ability to trust
the run.** Consider where a flip can land:

| location | consequence |
|---|---|
| an activation, mid-forward | usually harmless — averaged away by the next layer, or a single bad token |
| a **gradient** | perturbs one update; probably absorbed by the optimizer |
| a **weight** | persists forever, and is written into every subsequent checkpoint |
| an **optimizer moment** (Adam `m`/`v`) | persists, and corrupts every future update of that parameter |
| the **exponent bits** of a bf16 weight | `1.0 → 2¹²⁸`. One bit. NaNs propagate through the whole model on the next step |
| a **loss-scale** or **block scale** in FP8/FP4 training | an entire block of the tensor becomes garbage — and block-scaled formats mean one flip has 16–32× the blast radius |

That last row is the one the low-precision track has to hear. **Reducing precision increases the
value of each surviving bit.** In bf16, 8 of 16 bits are exponent. In an MX or NVFP4 block, a
single scale byte governs 32 elements — flip its exponent and you have scaled a whole block by
2¹²⁸. The FP4/block-scaling material downstream and the ECC material here are the same
conversation: as you compress the representation, each bit carries more meaning, so each bit
deserves more protection. Compression and error correction are opposite operations on the same
quantity, and running a 10,000-GPU job in 4 bits is running both of them at once, hard.

### What to actually do — the operational list

1. **Never disable ECC** to reclaim the ~6.25% of HBM capacity and a few percent of bandwidth.
   People do this. It is a false economy at any scale above one node.
2. **Monitor `nvidia-smi -q -d ECC`, `dmesg`, and Xid errors continuously.** A GPU with rising
   correctable ECC counts or a growing remapped-row count should be drained *before* it takes a job
   down. Xid 48/63/64/94/95 and "row remap pending" are the ones to alert on.
3. **Checkpoint frequently, and checksum the checkpoints.** A checkpoint written from corrupted
   memory propagates the corruption to every restart. Hash on write, verify on read (§5).
4. **Watch the loss curve as a corruption detector.** An unexplained loss spike is the cheapest SDC
   detector you have, and re-running the last few steps from the previous checkpoint on a different
   node is the cheapest confirmation.
5. **Deterministic replay for suspected SDC.** Meta's and Google's SDC papers both make the point
   that the only reliable way to find a "core that doesn't count" is to run the same computation
   twice on different hardware and compare. That is expensive, and it is done anyway.
6. **Assume it is a rate, not an event.** Google's *"Cores that don't count"* (HotOS 2021) and
   Meta's *"Silent Data Corruptions at Scale"* (arXiv:2102.11245) both report that SDC is a
   *systemic, cross-generational* issue, not a defective-batch anomaly. Meta's paper reports running
   silent-error tests *"across hundreds of thousands of machines in our fleet"*, yielding
   *"hundreds of CPUs detected for these errors, showing that SDCs are a systemic issue across
   generations"*, and notes explicitly that SDCs *"are not captured by error reporting mechanisms
   within a CPU and hence are not traceable at the hardware level"*. Their conclusion is that the
   fix requires *"not only hardware resiliency and production detection mechanisms, but also robust
   fault-tolerant software architectures"* — i.e. **you cannot buy your way out of this with ECC.**

The one-sentence version to give a student: **at ten thousand GPUs, the question is not whether a
bit will flip during your run, it is how many, and whether you will notice.**

---

# 5. Hashing — adjacent, and needed

Hashing is the third face of the same subject: **compress to a fixed size while deliberately
destroying structure.** Compression preserves all the information in fewer bits; hashing throws
almost all of it away, and the design goal is that what survives is *uniformly spread*.

## 5.1 Non-cryptographic hashes

Goals, in priority order: **speed**, **avalanche** (one input bit flips ~half the output bits), and
**no clustering on realistic keys** (sequential integers, similar strings, aligned pointers).
Explicitly *not* a goal: resistance to an adversary who is trying to collide you.

### FNV-1a

```c
    hash = 0xcbf29ce484222325;                  // 64-bit offset basis
    for (byte b : data) { hash ^= b; hash *= 0x100000001b3; }   // prime
```

Four lines, no tables, no dependencies. Byte-at-a-time, so ~1 byte/cycle — fine for short keys,
slow for long ones. **Verified, §7.9:** FNV-1a's avalanche is measurably poor — a single input bit
flip changes on average **25.6 of 64 output bits**, against the ideal of 32. And on sequential keys
the clustering is visible by eye:

```
   FNV-1a low 16 bits of "key0000".."key0015":
   27BA 296D 2454 2607 20EE 22A1 1D88 1F3B 1A22 1BD5 0AE3 0930 0E49 0C96 11AF 0FFC
```

The high nibble barely moves. Feed those into a power-of-two-sized bucket array using the *high*
bits and you get a hot spot; use the low bits and you're fine. This is exactly the class of bug
that makes a hash table quietly quadratic, and it is why "just use FNV" is bad advice for anything
but tiny keys.

By contrast, **verified, §7.9:** `splitmix64` (a finaliser-style mixer: xor-shift, multiply,
xor-shift, multiply, xor-shift) achieves an avalanche of **31.997 / 64** — indistinguishable from
ideal. A good finaliser is cheap; not having one is the usual defect.

### MurmurHash3 and xxHash

**MurmurHash3** (Appleby, 2011) processes 4 or 16 bytes per round with multiply-rotate-xor, and
finishes with a strong finaliser. It was the standard choice for a decade and is still in
Cassandra, Hadoop, and Guava.

**xxHash** (Collet) is the current default. From its README (fetched): three families — **XXH32**,
**XXH64**, and **XXH3/XXH128** (vectorised, since v0.8.0) — and on an i7-9700K:

| hash | throughput |
|---|---|
| XXH3 (SSE2) | **31.5 GB/s** |
| City64 | 22.0 GB/s |
| XXH64 | 19.4 GB/s |
| XXH32 | 9.7 GB/s |
| SipHash | 3.0 GB/s |

All variants *"successfully complete the SMHasher test suite"*, which is the quality bar: SMHasher
tests avalanche, differential behaviour, keyset-specific collisions, distribution over buckets, and
speed. **"Passes SMHasher" is the correct definition of "good non-cryptographic hash"** — better
than any hand-waving, and checkable.

31.5 GB/s is faster than DRAM. At those speeds, hashing every block you read is genuinely free,
which is why xxHash ended up in zstd's frame checksums, ZFS, and RocksDB.

### Hash flooding, and where "non-cryptographic" bites

If an attacker can choose your keys, they can choose keys that all land in one bucket, turning an
`O(1)` hash table into an `O(n)` list and your web server into a DoS victim (the 2011
"hash-flooding" disclosures affected PHP, Python, Ruby, Java, and more). The fix is a **keyed**
hash with a per-process random seed: **SipHash** (Aumasson & Bernstein, 2012), a PRF designed to be
fast on short inputs. It is why Python's `PYTHONHASHSEED` exists, why Rust's default `HashMap` uses
SipHash-1-3 (and why swapping in a faster hasher is an explicit, documented decision), and why the
Linux kernel uses `siphash` for network-facing hash tables.

Rule: **non-cryptographic hash for data you produced; keyed hash for data an attacker produced.**

## 5.2 Cryptographic hashes

A cryptographic hash `H` must provide:

| property | definition | broken means |
|---|---|---|
| **preimage resistance** | given `h`, hard to find `x` with `H(x) = h` | ~`2ⁿ` work |
| **second preimage** | given `x`, hard to find `x' ≠ x` with `H(x') = H(x)` | ~`2ⁿ` work |
| **collision resistance** | hard to find *any* `x ≠ y` with `H(x) = H(y)` | ~`2^(n/2)` work — the birthday bound |
| **avalanche** | one input bit flips ~half the output bits | — |

Collision resistance is only `n/2` bits strong, and that halving is the birthday bound of §5.3. It
is the reason a 128-bit hash is not enough for collision resistance and a 256-bit one is.

| hash | output | status |
|---|---|---|
| MD5 | 128 | **broken** — collisions in seconds (Wang 2004); chosen-prefix collisions practical. Still fine as a non-crypto checksum, never for security |
| SHA-1 | 160 | **broken** — SHAttered (2017, Google/CWI) produced two PDFs with the same hash for ~2⁶³ work; SHA-1 is dead for signatures. Git migrated away from relying on it for security |
| SHA-2 (SHA-256/512) | 256/512 | **secure**. Merkle–Damgård. Vulnerable to **length-extension** — given `H(m)` and `len(m)` you can compute `H(m ‖ pad ‖ suffix)` without knowing `m`, which is why you use HMAC and not `H(secret ‖ message)` |
| SHA-3 (Keccak) | 224–512 | **secure**. Sponge construction, structurally different from SHA-2 — chosen in the 2012 NIST competition as insurance against a break of the Merkle–Damgård family, not because SHA-2 was weak. Not length-extendable. Slower in software than SHA-2 |
| BLAKE2 | 256/512 | secure, faster than SHA-2 in software |
| **BLAKE3** | 256 (XOF: any length) | secure, and very fast |

### BLAKE3 and the connection to §5.5

From the BLAKE3 README (fetched): *"Much faster than MD5, SHA-1, SHA-2, SHA-3, and BLAKE2"*, and
*"Highly parallelizable across any number of threads and SIMD lanes, because it's a Merkle tree on
the inside."* It is *"one algorithm with no variants"*, functions as *"a PRF, MAC, KDF, and XOF, as
well as a regular hash"*, defaults to 256-bit output, and is *"secure against length extension,
unlike SHA-2"*.

That middle claim is the interesting one and closes a loop with §5.5: **BLAKE3 is fast because it is
internally a Merkle tree.** Split the input into 1 KiB chunks, hash them independently — which is
embarrassingly parallel across cores and SIMD lanes — and combine pairwise up a binary tree.
Serial hashes like SHA-256 are inherently sequential: block `n+1`'s compression depends on block
`n`'s output. Tree hashing removes that dependency and buys you the whole machine. The same
structure additionally gives verified streaming and incremental updates for free (§5.5).

**Hardware matters too**: x86-64 SHA-NI and ARMv8's crypto extensions make SHA-256 ~5–10× faster
than a software implementation, which sometimes flips the "which hash is fastest" answer on
specific hardware. Measure.

## 5.3 The birthday bound

In a room of 23 people, the chance that two share a birthday is >50%. Not 183 people — 23. The
reason is that you are counting *pairs*: 23 people make 253 pairs.

Generally, drawing uniformly from `N` possibilities, the expected number of draws before the first
collision is

```
    E[draws] ≈ √(π/2 · N)  ≈ 1.2533 √N
```

and the probability of at least one collision after `k` draws is `≈ 1 − e^(−k²/2N)`, which passes
½ at `k ≈ 1.1774 √N`.

**Verified, §7.9** — 200 trials per row, drawing uniformly at random until the first collision:

```
   bits   theory √(π/2 · 2^b)   measured mean
    16          320.8              320.6
    20         1283.4             1235.4
    24         5133.6             5128.0
    28        20534.3            20296.5
```

Theory and measurement agree to within a few percent. Have the student run it; the `√N` scaling
becomes intuitive in a way no amount of algebra achieves.

### Consequences, in the units people actually care about

- An `n`-bit hash gives `n/2` bits of collision resistance. **MD5's 128 bits mean 2⁶⁴ work** — that
  was expensive in 1995 and is a weekend now, before you even count MD5's structural breaks.
- A **64-bit** hash collides after ~5 billion items. That is not a hypothetical for a large storage
  system — it is Tuesday. Never content-address with 64 bits.
- A **128-bit** hash (2⁶⁴ ≈ 1.8×10¹⁹) is fine for accidental collisions and *not* fine against an
  adversary.
- A **256-bit** hash gives 2¹²⁸ collision work, which is beyond any physically realisable
  computation. This is why SHA-256 and BLAKE3-256 are the sizes they are.
- **Git's history** is exactly this argument playing out: SHA-1's 80-bit collision resistance was
  fine against accidents forever, and became untenable against an adversary once SHAttered showed a
  chosen collision for 2⁶³ work. Git's transition plan to SHA-256 exists for that reason and no
  other.
- The same bound governs **UUID v4** (122 random bits → collisions at ~2⁶¹, safely never),
  **hash-based deduplication** (§5.4), and **Bloom filter** sizing.

## 5.4 Content-addressable storage

**The idea:** name a piece of data by the hash of its content, rather than by a location.

```
    location-addressed:   /var/lib/things/00042.bin   "where it is"
    content-addressed:    sha256:9f86d081884c7d65…    "what it is"
```

Four properties fall out immediately, and they are the reason so many systems converged on this:

1. **Integrity for free.** Re-hash on read and compare with the name. Corruption is detected
   automatically because the name *is* the checksum. (Notice: this is §4's error *detection*
   arriving via a completely different route.)
2. **Deduplication for free.** Identical content has an identical name, so it is stored once. A
   backup system storing 100 near-identical VM images stores the shared blocks once.
3. **Immutability.** You cannot change content without changing its name. So caching is trivially
   correct and needs no invalidation — the hardest problem in computer science becomes not a
   problem.
4. **Location independence.** Any peer holding the bytes can serve them, and the client can verify.
   This is what makes decentralised distribution possible at all.

### Where it lives

**Git.** Every object — blob, tree, commit, tag — is stored under the SHA-1 of
`"<type> <length>\0<content>"`. A commit names its tree by hash; a tree names blobs and subtrees by
hash; a commit names its parents by hash. So a commit hash **transitively fixes the entire history
and the entire tree state**. That is why you can't quietly rewrite history in a repo someone else
has cloned, and why `git fsck` can verify a repository from first principles. Git is a Merkle DAG
(§5.5) that happens to have a version-control UI. Packfiles then add **delta compression** between
similar objects plus zlib on top (§2.7) — a nice example of content-addressing and compression
composing.

**IPFS.** Content ID (CID) = multihash of the content, plus codec and version metadata. Files are
chunked, the chunks form a Merkle DAG, and the root CID names the whole thing. Any node can serve
any block and the requester verifies it, which is exactly property 4.

**Docker/OCI images.** Layers are content-addressed by digest; the manifest lists layer digests; the
image is named by the manifest digest. `docker pull` deduplicates layers you already have, and
`@sha256:…` pins an image immutably in a way a tag never can.

**Backup and dedup systems.** Restic, borg, ZFS dedup, Data Domain: chunk (often with a
content-defined chunking scheme like Rabin fingerprinting, so that inserting a byte doesn't shift
every subsequent boundary), hash each chunk, store unique chunks once. Content-defined chunking is
itself worth teaching — it is the fix for the "insert one byte at the start and every fixed-size
block changes" problem, and it is a rolling-hash trick.

**Nix and Bazel.** Build outputs are addressed by the hash of *all inputs* (sources, compiler,
flags, dependencies). Identical inputs → identical hash → reuse the cached output. This is
content-addressing applied to computation, and it is what makes remote build caches sound.

### The trade

Content addressing costs you the ability to *update in place* — every change makes a new name, so
you need a mutable pointer layer somewhere (a git branch ref, an IPNS name, a Docker tag). And it
costs a hash computation per read if you verify (which at 31 GB/s for xxHash, or ~2 GB/s for
BLAKE3, is usually free). The garbage-collection problem — which objects are still reachable — is
the other real cost, and is why `git gc` exists.

## 5.5 Merkle trees

Ralph Merkle, 1979. **Hash the leaves; hash each pair of hashes; repeat to a single root.**

```
                        ROOT = H(H₁₂ ‖ H₃₄)
                       /                  \
              H₁₂ = H(H₁‖H₂)        H₃₄ = H(H₃‖H₄)
              /        \              /        \
        H₁=H(d₁)  H₂=H(d₂)      H₃=H(d₃)  H₄=H(d₄)
           |         |             |         |
          d₁        d₂            d₃        d₄
```

The root is a fixed-size commitment to all the data. Change any byte of `d₃` and the root changes.

### The property that makes it worth the structure

**Proof of inclusion in `O(log n)`.** To prove `d₃` is in the tree, you supply `d₃` plus the sibling
hashes on the path to the root — here `H₄` and `H₁₂`, two hashes — and the verifier recomputes the
root. **For a billion leaves that is 30 hashes**, about 1 KB, against a gigabyte of data. A plain
hash of the concatenation gives you integrity but *no* efficient proof about a part.

### Where they are

| system | use |
|---|---|
| **Git** | the object graph is a Merkle DAG; a commit hash fixes all history |
| **Bitcoin / Ethereum** | transactions in a block form a Merkle tree; the root goes in the header, enabling SPV clients to verify a transaction with `log n` hashes instead of the whole chain. Ethereum uses Merkle-Patricia tries for state |
| **ZFS** | the entire pool is a Merkle tree — every block pointer contains the checksum of the block it points to, up to the uberblock. A scrub verifies the whole tree, and with a mirror or RAID-Z it *repairs* from a good copy. This is §4's error correction reached through hashing |
| **Certificate Transparency** | an append-only Merkle log of every issued TLS certificate; auditors verify consistency between two roots in `O(log n)` |
| **BitTorrent v2 / IPFS** | per-piece verification, so you can trust a piece from an untrusted peer immediately rather than after the whole file |
| **Cassandra / DynamoDB / Riak** | anti-entropy repair: two replicas exchange Merkle trees and only transfer the subtrees whose hashes differ. Finding the diff between two 1 TB replicas costs `log n` round trips, not 1 TB of transfer |
| **BLAKE3** | *internally* a Merkle tree, for parallelism and verified streaming (§5.2) |
| **Secure boot / dm-verity** | Android and Chrome OS verify a read-only partition with a Merkle tree over blocks, so boot verifies the root only and each block is checked lazily on access |

The anti-entropy row is the one to make sure lands, because it is the clearest engineering payoff:
**comparing two large datasets over a network costs `O(log n)` when they are nearly identical**, and
that is a Merkle tree and nothing else.

### The connection back to §4

ZFS and Btrfs are the clean demonstration that **detection and correction are separable, and can be
built from different families**. A Merkle tree of checksums *detects* corruption at any level, from
a flipped bit to a misdirected write to a disk that silently returned stale data. Redundancy —
mirroring, RAID-Z, or Reed–Solomon parity (§4.5) — *corrects* it. Neither alone is enough: RAID
without checksums cannot tell which copy is right (this is the classic "RAID-5 write hole" and the
reason `md` RAID's `check` can find mismatches but not resolve them), and checksums without
redundancy can only tell you your data is gone. Put them together and you get a filesystem that
heals itself, which is the whole ZFS pitch and is, structurally, "hashing for detection,
coding for correction."

---

# 6. Curriculum — three units, in dependency order

Three units. Each delivers **one idea**. Each is positioned so that the storage track and the
networking track can both draw on it without either owning it, and so that the AI track gets its
two connections (cross-entropy, and quantisation-as-lossy-compression) for free.

The dependency chain is strict and worth stating up front, because it is what makes three units the
right number rather than six:

```
   Unit 1: information has a measure, and it is a floor
              │
              │  (you cannot explain why a compressor is good
              │   without a yardstick for "good")
              ▼
   Unit 2: redundancy can be removed — and the floor moves when the model does
              │
              │  (you cannot explain why anyone would ADD redundancy
              │   until you have watched someone spend effort removing it)
              ▼
   Unit 3: redundancy can be added back, in a shape noise cannot destroy
```

Every exercise below runs on **Compiler Explorer's C++ executor** (GCC 15.2, `executorRequest`),
which was verified during this research to compile, link `zlib 1.3.1`, execute, and return stdout.
Every one has a machine-checkable pass/fail condition — an assertion, a known test vector, or an
exhaustive enumeration — so they can be graded automatically. All six were **actually run**; their
real output is in §7.

---

## Unit 1 — Information has a measure, and it is a floor

**The ONE idea.** *Uncertainty is measurable in bits, and that measurement is a hard lower bound on
how small you can make the data — but only for the model you assumed. Change the model and the
floor moves.*

The second half of that sentence is the part everyone skips and the part that does all the work
later. A student who leaves this unit believing "entropy is a fixed property of a file" will be
confused by every result in Unit 2. A student who leaves believing "entropy is a property of a
*model of* a file, and better models have lower entropy" is ready for everything, including the
fact that a language model's loss is a compression ratio.

**Covers:** surprisal and why it is a logarithm; entropy as expected code length; the units trap
(bits vs nats vs perplexity); the source coding theorem and the counting argument; the pigeonhole
corollary that no compressor shrinks everything; conditional entropy and the chain rule; mutual
information; KL divergence; **cross-entropy loss as literally this**; Kolmogorov complexity and its
uncomputability; channel capacity and the channel coding theorem in outline; the separation
theorem as the reason systems are shaped the way they are.

**Exercise 1 — entropy vs gzip.** *(runnable; verified, §7.1)*
Compute the order-0 Shannon entropy of a given text in bits/symbol, and the implied floor in bytes.
Then compress the same buffer with zlib at levels 1, 6 and 9 and print all of it side by side. Do
it on three inputs: highly repetitive text, English prose, and pseudo-random letters. Then compute
the **order-1 conditional entropy** `H(Xₙ | Xₙ₋₁)` from bigram counts.

*Assertions:* zlib round-trips; entropy is in `[0, log₂ |alphabet|]`; `H(X|X_prev) ≤ H(X)`.

*The two things they must explain in writing, and this is the real assessment:*
1. Why DEFLATE **beats** the order-0 floor by 13–50× on English. (Because English is not
   memoryless, and the theorem bounds a memoryless source.)
2. Why DEFLATE **loses** to it on pseudo-random letters — 5.003 bits/symbol against a 4.697-bit
   floor. (Because there is no structure to find, and Huffman's integer bit lengths plus block
   headers cost more than they save. A compressor is a bet.)

**Exercise 2 — cross-entropy by hand.** *(paper + 20 lines of code)*
Given a true distribution `p` over a 5-symbol vocabulary and two model distributions `q₁`, `q₂`,
compute `H(p)`, `H(p,q₁)`, `H(p,q₂)`, `D_KL(p‖q₁)`, `D_KL(p‖q₂)`. Assert
`H(p,q) = H(p) + D_KL(p‖q)` to within floating-point tolerance for both. Then convert a reported
PyTorch loss of 2.3 nats/token into bits/token, into perplexity, and — given 4 bytes/token — into
bits per byte and an implied compression ratio against plain text. Finally, set one `q(x) = 0`
where `p(x) > 0` and observe the infinity.

*Why this exercise:* it takes ten minutes and it permanently welds "loss curve" to "compression
ratio". Assert `D_KL(p‖q) ≠ D_KL(q‖p)` too — the asymmetry is the thing people misremember.

**Where the other tracks hook in.** Networking gets channel capacity and Shannon–Hartley (why more
spectrum beats more power). Storage gets the source coding theorem and the "no compressor shrinks
everything" corollary. AI gets cross-entropy, perplexity, and the irreducible-loss term in scaling
laws.

---

## Unit 2 — Removing redundancy: modelling, then coding

**The ONE idea.** *Every compressor is a model plus a coder. The coder is a solved problem — it
turns a probability into `−log₂ p` bits, essentially exactly. All remaining progress is modelling.*

Teach the two-box diagram in the first ten minutes and refer to it constantly. Huffman, arithmetic,
range and ANS are **coders**. LZ77, LZ78, context mixing, the BWT and a 70-billion-parameter
transformer are **models**. Every codec in the section is then just a choice of one from each
column, plus engineering.

**Covers:** prefix codes and Kraft; Huffman construction, the exchange-argument proof of optimality,
the `H ≤ L < H+1` bound, canonical codes, and the integer-bit-length limitation; arithmetic coding
(intervals, renormalisation, the underflow/straddle case) and why it fixes that limitation; range
coding and the patent history; ANS/rANS/tANS and why Zstandard exists; LZ77 sliding windows, hash
chains, overlapping matches, lazy and optimal parsing; LZ78/LZW and the GIF patent story; how real
formats compose these — DEFLATE, Zstandard, Brotli, LZ4, bzip2; the Burrows–Wheeler transform, its
`O(n)` inverse, and the FM-index in bioinformatics; columnar compression (dictionary, RLE,
bit-packing, FOR, delta, delta-of-delta, XOR, roaring) and late materialisation; **the
ratio-vs-speed curve and how to pick a point on it**; and lossy compression as
transform-quantise-entropy-code, with JPEG worked through and **neural-network quantisation shown
to be the same three steps**.

**Exercise 3 — Huffman.** *(runnable; verified, §7.3)*
Build a Huffman tree from symbol frequencies in a given text. Derive code lengths, then **canonical**
codes from the lengths alone (the DEFLATE rule). Encode, decode with a first-code/count table,
and assert:
- **round-trip is byte-identical**;
- **Kraft sum is exactly 1.0** (a complete prefix code);
- **`H(X) ≤ L_avg < H(X) + 1`** — the optimality bound, machine-checked.

Then a second part that makes the limitation visceral: for a two-symbol source with
`p ∈ {0.5, 0.6, …, 0.99}`, print `H(p)`, the Huffman cost (always exactly 1 bit), and the
percentage overhead. At `p = 0.99` it is **1138%**. Ask them to explain, in one sentence, why no
prefix code can do better, and what would have to change.

**Exercise 4 — LZ77 match finding.** *(runnable; verified, §7.5)*
Implement DEFLATE-shaped LZ77: 32 KiB window, minimum match 3, maximum 258, hash chains on 3-byte
prefixes with a bounded chain walk. Emit literals and `⟨distance, length⟩` tokens. Write the
decompressor too. Assert:
- **round-trip is byte-identical**, including the **overlapping-match** case — test `⟨1, 100⟩`
  explicitly, since copying with `memcpy` instead of byte-at-a-time is the classic bug and must
  fail the test;
- match coverage and literal count are reported;
- varying `max_chain` from 4 to 4096 changes ratio and time monotonically — plot it. **That plot is
  the ratio-vs-speed curve, generated by the student, and it is the point of the exercise.**

*Extension, cheap and worth it:* implement forward BWT and the `O(n)` inverse. Assert
`BWT("banana") = "nnbaaa"` with primary index 3, assert the inverse round-trips, and measure the
runs-per-byte before and after on real text (verified: 0.9778 → 0.0088, a 111× reduction).

**Exercise 5 — the codec bake-off.** *(runnable, using zlib; extendable to zstd/lz4 offline)*
On three corpora (English text, JSON, and a binary blob), for zlib levels 1, 6 and 9: measure ratio,
compression throughput, and decompression throughput. Produce the table. Then answer, in writing:
*which level would you use for a package repository, for a write-ahead log, and for a 40 GbE link,
and why?* Reference §2.13's decision table. The transferable skill is the measurement, not the
answer.

**Where the other tracks hook in.** Storage gets columnar encodings, the ratio/speed decision
table, and the FM-index. Networking gets DEFLATE (`Content-Encoding: gzip`), Brotli and its static
dictionary, and the "compress iff bytes-saved / bandwidth > compression-time" rule. AI gets §3.5:
quantisation is transform-quantise-code with the entropy coder deliberately removed, and a block
scale is a per-block quantisation table.

---

## Unit 3 — Adding redundancy back: detection, then correction

**The ONE idea.** *Redundancy deliberately added in the right algebraic shape lets you not only
detect corruption but reconstruct the original — and the guarantee is a theorem about an error
model, which is exactly why an adversary breaks it.*

The unit is deliberately placed **after** compression, because "we just spent a whole unit removing
redundancy, now we are going to add some back on purpose" is a question the student will ask
themselves, and the answer — the separation theorem from Unit 1 — is one of the most satisfying
things in the subject.

**Covers:** Hamming distance, minimum distance, the sphere-packing picture, and the
detect/correct formulas; the Singleton bound and MDS codes; parity and checksums, and why the
Internet checksum is weak; **CRC** as polynomial division over GF(2), the "undetected iff `G | E`"
lemma and the burst-error proof, implementation (bitwise, table, hardware), and where it is used;
**Hamming codes**, the syndrome-is-the-position trick, and SECDED; **Reed–Solomon** as oversampling
a polynomial, GF(2⁸), MDS optimality, erasure vs error decoding, and its appearances from CDs to
RAID-6 to object stores; LDPC and turbo codes in outline, belief propagation, and **why LDPC is
what makes QLC NAND possible**; **ECC memory** — (72,64) SECDED, chipkill, patrol scrubbing, EDAC,
the Google and Meta field-study numbers, and why desktops don't have it; **Rowhammer and why ECC
was insufficient**, including the ECCploit timing side channel; **DDR5 on-die ECC** and what it is
not; **ECC in HBM and the operational arithmetic for long training runs**; and hashing — non-crypto
vs cryptographic, the birthday bound, content-addressable storage, and Merkle trees.

**Exercise 6 — CRC-32 against known vectors.** *(runnable; verified, §7.2 — the best exercise here,
because the vectors are unambiguous)*
Implement CRC-32 (reflected, poly `0xEDB88320`, init `0xFFFFFFFF`, final XOR `0xFFFFFFFF`) both
bitwise and table-driven. Assert against the universal check values:

```
    CRC-32("123456789") == 0xCBF43926
    CRC-32("")          == 0x00000000
    CRC-32("a")         == 0xE8B7BE43
```

and cross-check against `zlib`'s `crc32()` in the same program. Then CRC-32C (`0x82F63B78`
reflected), asserting `CRC-32C("123456789") == 0xE3069283`.

Then the two parts that teach rather than test:
- **Burst-error property.** Corrupt a 64-byte message with random bursts of every length 1–32 at
  every offset. **Assert zero undetected**, over ~127,000 trials. Then try length-33 bursts and
  reason about the `2⁻³¹` expectation.
- **Verify the folklore, find it wrong.** Compute the number of nonzero terms in `0x04C11DB7` and
  in `0x1EDC6F41`. Determine whether `(x+1)` divides each. Then compute the multiplicative order of
  `x` modulo each polynomial. Discover that **CRC-32 does not detect all odd-weight errors** (15
  terms, `G(1) = 1`) while CRC-32C does (18 terms, `G(1) = 0`), and that CRC-32's generator is
  *primitive* with `ord(x) = 2³²−1`. Then write down what each fact guarantees.

**Exercise 7 — Hamming(7,4), exhaustively.** *(runnable; verified, §7.7)*
Implement encode and syndrome-decode for Hamming(7,4) with parity at positions 1, 2, 4.
Then assert, over **all 16 data words × all 7 bit positions**:
- the syndrome, read as a binary number, **equals the flipped position** — all 112 cases;
- the decoder **recovers the original data** — 112/112.

Then compute `d_min` over all 120 codeword pairs and assert it is exactly 3. Then flip **two** bits
in every one of the 336 possible ways and observe that **every single one is silently decoded to
the wrong word** — which is the motivation for the last part: add an overall parity bit, assert
`d_min = 4`, and assert all 448 double-error patterns in the (8,4) code are now **flagged
uncorrectable** rather than mis-corrected. That is SECDED, and that is your server's RAM.

**Exercise 8 — Reed–Solomon erasure recovery.** *(runnable; verified, §7.8)*
Build GF(2⁸) with `0x11D`: log/antilog tables, multiply, divide, inverse. Assert
`inv(a)·a == 1` for all nonzero `a`.

Then the *polynomial* view, because it is the one that explains the idea: treat `k = 4` data bytes
as the coefficients of a degree-3 polynomial, evaluate at `n = 8` distinct nonzero points to get 8
shards, then recover by Lagrange interpolation. **Assert recovery from all 70 of the possible
4-of-8 survivor sets, exhaustively.** Then assert that with only 3 shards recovery correctly fails.

Then the *systematic* view, because it is the one real systems use: `G = [I ; C]` with a Cauchy
parity block (`C[i][j] = 1/(xᵢ ⊕ yⱼ)`, disjoint `x` and `y`), `k = 6`, `m = 3`. Reconstruct by
Gaussian elimination over GF(2⁸) on the surviving rows. **Assert recovery from all 84 of the 6-of-9
survivor sets with zero singular matrices.** Then have them compute the storage overhead and failure
tolerance of RS(6,3), RS(10,4) and 3× replication, and explain in one paragraph why every large
object store made the switch and what it cost them (repair bandwidth).

**Exercise 9 — the birthday bound.** *(runnable; verified, §7.9)*
Draw uniformly at random from `2^b` values until the first repeat; average over 200 trials; compare
against `√(π/2 · 2^b)` for `b ∈ {16, 20, 24, 28}`. Assert agreement within 10%. Then measure the
**avalanche** of FNV-1a and of a good finaliser (splitmix64-style) — mean output bits flipped per
single input bit flip, over 20,000 trials — and observe 25.6/64 versus 32.0/64. Then print the low
16 bits of FNV-1a over `"key0000".."key0015"` and *look at the clustering*. Finish with the
arithmetic: how many objects before a 64-bit content-address collides, and why git is moving to
SHA-256.

**Where the other tracks hook in.** Storage gets Reed–Solomon erasure coding, LDPC in NAND,
checksummed filesystems, Merkle trees, and content addressing. Networking gets CRC at every layer,
LDPC in Wi-Fi and 5G, and the end-to-end argument made concrete by the fact that Ethernet
regenerates its CRC at every hop. AI systems gets §4.10 in full: ECC in HBM, the Llama 3 failure
table, and why a silent bit flip in a block scale is worse than a crash.

---

## Why three and not six

Because the three ideas — *measure it*, *remove it*, *add it back* — are each atomic, and the
material in between is elaboration that a motivated student can absorb in the context of one big
idea. Splitting Huffman from LZ77 into separate units would break the two-box (model/coder)
framing that makes the whole of §2 legible. Splitting detection from correction would break the
distance/sphere-packing framing that makes the whole of §4 legible.

If it *must* be four, split Unit 2 at the lossless/lossy line — but then the "quantisation is
lossy compression" connection needs the transform-quantise-code diagram repeated at the top of the
new unit, because that diagram is doing the load-bearing work.

---

# 7. The verified exercise harness

Every program below was compiled and **executed** on Compiler Explorer
(`https://godbolt.org/api/compiler/g152/compile`, GCC 15.2, `executorRequest: true`) during this
research. The source is verbatim; the output is stdout, transcribed, not reconstructed. These are
the exercises from §6 in reference-solution form - give students the assertions and the test
vectors, not these.

**How to run one:** POST to the compile endpoint with
`{"source": ..., "options": {"userArguments": "-O2 -std=c++20 -lz", "compilerOptions": {"executorRequest": true}, "filters": {"execute": true}, "libraries": [{"id": "zlib", "version": "1.3.1"}]}, "lang": "c++"}`.
The response's `stdout` array carries the program output and `code` is the exit status. The zlib
library id/version pair was confirmed against `https://godbolt.org/api/libraries/c++`.

## 7.1 Entropy vs what zlib actually achieves

Unit 1, Exercise 1. The order-0 entropy floor, three corpora, and DEFLATE at three levels - plus the order-1 conditional entropy.

Build: zlib 1.3.1, `-O2 -std=c++20 -lz`

```cpp
#include <zlib.h>
#include <cstdio>
#include <cmath>
#include <string>
#include <vector>
#include <array>

static double order0_entropy(const std::string& s){
    std::array<size_t,256> c{}; for(unsigned char ch: s) c[ch]++;
    double H=0, n=s.size();
    for(size_t k: c) if(k){ double p=k/n; H -= p*std::log2(p); }
    return H;
}
static double order1_entropy(const std::string& s){
    // H(X_n | X_{n-1}) estimated from bigram counts
    static size_t big[256][256]={}; static size_t ctx[256]={};
    for(size_t i=1;i<s.size();++i){ big[(unsigned char)s[i-1]][(unsigned char)s[i]]++; ctx[(unsigned char)s[i-1]]++; }
    double H=0, n=s.size()-1;
    for(int a=0;a<256;a++) if(ctx[a]) for(int b=0;b<256;b++) if(big[a][b]){
        double pjoint = big[a][b]/n, pcond = (double)big[a][b]/ctx[a];
        H -= pjoint*std::log2(pcond);
    }
    return H;
}
static size_t deflate_size(const std::string& s, int level){
    uLongf n = compressBound(s.size());
    std::vector<Bytef> out(n);
    int rc = compress2(out.data(), &n, (const Bytef*)s.data(), s.size(), level);
    return rc==Z_OK ? n : 0;
}
int main(){
    // A repetitive English-ish text: entropy of the *symbols* vs what DEFLATE achieves.
    std::string t;
    const char* line = "the quick brown fox jumps over the lazy dog. ";
    for(int i=0;i<200;i++) t += line;
    std::string rnd; { unsigned x=12345; for(int i=0;i<9000;i++){ x=x*1664525u+1013904223u; rnd += char('a'+ (x>>24)%26); } }
    std::string english =
      "It is a truth universally acknowledged, that a single man in possession of a good "
      "fortune, must be in want of a wife. However little known the feelings or views of such "
      "a man may be on his first entering a neighbourhood, this truth is so well fixed in the "
      "minds of the surrounding families, that he is considered the rightful property of some "
      "one or other of their daughters. ";
    { std::string e; for(int i=0;i<20;i++) e+=english; english=e; }

    struct { const char* name; const std::string* s; } cases[] = {
        {"repetitive", &t}, {"pseudo-random letters", &rnd}, {"english x20", &english}
    };
    for(auto& c: cases){
        const std::string& s = *c.s;
        double H0 = order0_entropy(s);
        size_t z6 = deflate_size(s,6), z9 = deflate_size(s,9), z1 = deflate_size(s,1);
        printf("%-24s n=%6zu  H0=%.3f bit/sym -> floor %6.0f B | zlib-1 %6zu  zlib-6 %6zu  zlib-9 %6zu  (%.3f bit/sym at -6)\n",
            c.name, s.size(), H0, H0*s.size()/8.0, z1, z6, z9, z6*8.0/s.size());
    }
    printf("\norder-1 conditional entropy of english text: %.3f bit/sym (order-0 was %.3f)\n",
        order1_entropy(english), order0_entropy(english));
    printf("zlib version: %s\n", zlibVersion());
}
```

**Output (actual):**

```
repetitive               n=  9000  H0=4.397 bit/sym -> floor   4946 B | zlib-1    130  zlib-6     96  zlib-9     96  (0.085 bit/sym at -6)
pseudo-random letters    n=  9000  H0=4.697 bit/sym -> floor   5285 B | zlib-1   5739  zlib-6   5628  zlib-9   5628  (5.003 bit/sym at -6)
english x20              n=  7520  H0=4.130 bit/sym -> floor   3882 B | zlib-1    313  zlib-6    286  zlib-9    286  (0.304 bit/sym at -6)

order-1 conditional entropy of english text: 2.820 bit/sym (order-0 was 4.130)
zlib version: 1.3
```

## 7.2a CRC-32 against known test vectors, and the burst-error property

Unit 3, Exercise 6, part 1. Bitwise and table-driven CRC-32 cross-checked against zlib, plus CRC-32C, plus an exhaustive burst sweep.

Build: zlib 1.3.1, `-O2 -std=c++20 -lz`

```cpp
#include <zlib.h>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <string>
#include <random>

// Reflected, bitwise. Poly 0xEDB88320 is the bit-reversal of 0x04C11DB7.
static uint32_t crc32_bitwise(const uint8_t* p, size_t n, uint32_t poly=0xEDB88320u){
    uint32_t c = 0xFFFFFFFFu;
    for(size_t i=0;i<n;i++){
        c ^= p[i];
        for(int k=0;k<8;k++) c = (c>>1) ^ (poly & (uint32_t)(-(int32_t)(c & 1)));
    }
    return ~c;
}
static uint32_t tbl[256];
static void init_tbl(uint32_t poly){ for(uint32_t i=0;i<256;i++){ uint32_t c=i; for(int k=0;k<8;k++) c=(c>>1)^(poly&(uint32_t)(-(int32_t)(c&1))); tbl[i]=c; } }
static uint32_t crc32_table(const uint8_t* p, size_t n){
    uint32_t c=0xFFFFFFFFu; for(size_t i=0;i<n;i++) c = tbl[(c ^ p[i]) & 0xFF] ^ (c>>8); return ~c;
}
int main(){
    init_tbl(0xEDB88320u);
    const char* v = "123456789";
    uint32_t a = crc32_bitwise((const uint8_t*)v, 9);
    uint32_t b = crc32_table((const uint8_t*)v, 9);
    uint32_t z = (uint32_t)crc32(0L, (const Bytef*)v, 9);
    printf("CRC-32/ISO-HDLC(\"123456789\") bitwise=%08X table=%08X zlib=%08X  expect CBF43926 -> %s\n",
        a,b,z, (a==0xCBF43926u && b==z && z==a) ? "PASS":"FAIL");

    // CRC-32C (Castagnoli), reflected poly 0x82F63B78; standard check value E3069283
    init_tbl(0x82F63B78u);
    uint32_t c = crc32_table((const uint8_t*)v, 9);
    printf("CRC-32C(\"123456789\") = %08X  expect E3069283 -> %s\n", c, c==0xE3069283u?"PASS":"FAIL");

    // Empty string and "a"
    init_tbl(0xEDB88320u);
    printf("CRC-32(\"\")=%08X (expect 00000000)  CRC-32(\"a\")=%08X (expect E8B7BE43)\n",
        crc32_table((const uint8_t*)"",0), crc32_table((const uint8_t*)"a",1));

    // Burst error property: CRC-32 detects EVERY burst of length <= 32.
    std::mt19937 rng(7);
    uint8_t msg[64]; for(auto&x:msg) x = rng()&0xFF;
    uint32_t base = crc32_table(msg,64);
    long tested=0, missed=0;
    for(int start=0; start<64*8-1; ++start)
      for(int len=1; len<=32 && start+len<=64*8; ++len)
        for(int trial=0; trial<8; ++trial){
            uint8_t m2[64]; memcpy(m2,msg,64);
            // flip a random error pattern confined to [start, start+len), first and last bit set
            uint32_t pat = (len>=32)? 0xFFFFFFFFu : ((rng() & ((1u<<len)-1)) | 1u | (1u<<(len-1)));
            for(int i=0;i<len;i++) if(pat>>i & 1) m2[(start+i)/8] ^= 1u<<((start+i)%8);
            tested++; if(crc32_table(m2,64)==base) missed++;
        }
    printf("burst test: %ld corrupted messages with burst length <= 32, undetected = %ld\n", tested, missed);

    // A burst of length 33 CAN slip through: find one.
    long tested33=0, missed33=0;
    for(int start=0; start+33<=64*8; ++start)
      for(int trial=0; trial<2000; ++trial){
            uint8_t m2[64]; memcpy(m2,msg,64);
            uint64_t pat = ((uint64_t)rng()<<32 | rng()) & ((1ull<<33)-1);
            pat |= 1ull | (1ull<<32);
            for(int i=0;i<33;i++) if(pat>>i & 1) m2[(start+i)/8] ^= 1u<<((start+i)%8);
            tested33++; if(crc32_table(m2,64)==base) missed33++;
      }
    printf("burst-33 test: %ld tried, undetected = %ld (expected ~ tried/2^31 = %.3f)\n",
        tested33, missed33, tested33/2147483648.0);
    return 0;
}
```

**Output (actual):**

```
CRC-32/ISO-HDLC("123456789") bitwise=CBF43926 table=CBF43926 zlib=CBF43926  expect CBF43926 -> PASS
CRC-32C("123456789") = E3069283  expect E3069283 -> PASS
CRC-32("")=00000000 (expect 00000000)  CRC-32("a")=E8B7BE43 (expect E8B7BE43)
burst test: 127096 corrupted messages with burst length <= 32, undetected = 0
burst-33 test: 960000 tried, undetected = 0 (expected ~ tried/2^31 = 0.000)
```

## 7.2b CRC generator polynomials - the folklore check

Unit 3, Exercise 6, part 2. Whether `(x+1)` divides the generator, and the multiplicative order of `x` - the two facts that generate every CRC guarantee.

Build: `-O2 -std=c++20`

```cpp
#include <cstdio>
#include <cstdint>
#include <vector>
// Work in GF(2)[x]/G(x), G of degree 32 given by its low 32 coefficients (normal, not reflected).
struct GF { uint32_t G; };
static uint32_t xmul(uint32_t a, uint32_t G){ uint32_t hi = a>>31; a<<=1; if(hi) a^=G; return a; }
static uint32_t pmul(uint32_t a, uint32_t b, uint32_t G){
    uint32_t r=0; for(int i=31;i>=0;--i){ r = xmul(r,G); if(b>>i & 1) r ^= a; } return r; }
static uint32_t ppow(uint32_t a, uint64_t e, uint32_t G){
    uint32_t r=1; while(e){ if(e&1) r=pmul(r,a,G); a=pmul(a,a,G); e>>=1; } return r; }
static int popc32(uint32_t v){ return __builtin_popcount(v); }
// order of x modulo G, by trial: order divides 2^32-1 only if G irreducible; do it generally by
// factoring candidate orders of the two known structures, else brute-force with a bounded loop.
static uint64_t order_of_x(uint32_t G, uint64_t limit){
    uint32_t v = 2;               // x
    for(uint64_t k=1;k<=limit;k++){ if(v==1) return k; v = xmul(v,G); }
    return 0;
}
int main(){
    struct { const char* name; uint32_t poly; } P[] = {
        {"CRC-32/ISO-HDLC  0x04C11DB7", 0x04C11DB7u},
        {"CRC-32C Castagnoli 0x1EDC6F41", 0x1EDC6F41u},
        {"CRC-16/CCITT      0x1021 (deg16)", 0x1021u},
    };
    for(auto& p: P){
        int terms = popc32(p.poly) + 1;   // + implicit x^deg
        printf("%s : %d nonzero terms -> G(1)=%d -> (x+1) %s divide G  => all odd-weight errors %s detected\n",
            p.name, terms, terms&1, (terms&1)?"does NOT":"DOES", (terms&1)?"NOT always":"always");
    }
    // multiplicative order of x, mod the degree-32 polys. If it is N, then no 2-bit error
    // within N bits of each other is ever undetected.
    for(int i=0;i<2;i++){
        uint32_t G=P[i].poly;
        // fast: test whether x^d == 1 for each divisor-candidate; do it by direct exponentiation
        // against the two plausible orders, then fall back to a bounded scan.
        uint64_t cands[] = {2147483647ull, 4294967295ull, 2147483646ull, 1073741823ull};
        printf("%s : ", P[i].name);
        bool found=false;
        for(uint64_t c: cands) if(ppow(2,c,G)==1){ printf("x^%llu = 1  ", (unsigned long long)c); found=true; }
        if(!found) printf("neither 2^31-1 nor 2^32-1 ");
        // exact order by scanning divisors of the smallest c that worked
        uint64_t best=0;
        for(uint64_t c: cands) if(ppow(2,c,G)==1 && (best==0||c<best)) best=c;
        if(best){
            uint64_t ord=best;
            for(uint64_t d=2; d*d<=best; ++d) if(best%d==0){
                if(ppow(2,best/d,G)==1 && best/d<ord) ord=best/d;
                if(ppow(2,d,G)==1 && d<ord) ord=d;
            }
            printf("| smallest tested order = %llu  => every 2-bit error inside %llu bits is detected\n",
                (unsigned long long)ord,(unsigned long long)ord);
        } else printf("\n");
    }
    // brute force short check: order of x mod CRC-16-CCITT (deg 16)
    { uint32_t G=0x1021u; uint32_t v=2; uint64_t k;
      for(k=1;k<200000;k++){ if(v==1) break; // v is a 16-bit value; adapt xmul for deg 16
        uint32_t hi=(v>>15)&1; v=(v<<1)&0xFFFF; if(hi) v^=G; }
      printf("CRC-16/CCITT: order of x = %llu (2^16-1 = 65535)\n", (unsigned long long)k); }
    return 0;
}
```

**Output (actual):**

```
CRC-32/ISO-HDLC  0x04C11DB7 : 15 nonzero terms -> G(1)=1 -> (x+1) does NOT divide G  => all odd-weight errors NOT always detected
CRC-32C Castagnoli 0x1EDC6F41 : 18 nonzero terms -> G(1)=0 -> (x+1) DOES divide G  => all odd-weight errors always detected
CRC-16/CCITT      0x1021 (deg16) : 4 nonzero terms -> G(1)=0 -> (x+1) DOES divide G  => all odd-weight errors always detected
CRC-32/ISO-HDLC  0x04C11DB7 : x^4294967295 = 1  | smallest tested order = 4294967295  => every 2-bit error inside 4294967295 bits is detected
CRC-32C Castagnoli 0x1EDC6F41 : x^2147483647 = 1  | smallest tested order = 2147483647  => every 2-bit error inside 2147483647 bits is detected
CRC-16/CCITT: order of x = 32767 (2^16-1 = 65535)
```

## 7.3 Huffman: construction, canonical codes, Kraft, and the integer-bit-length floor

Unit 2, Exercise 3.

Build: `-O2 -std=c++20`

```cpp
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <string>
#include <vector>
#include <queue>
#include <array>
#include <algorithm>

struct Node { int freq, sym; Node *l=nullptr,*r=nullptr; };
struct Cmp { bool operator()(Node*a,Node*b) const { return a->freq>b->freq; } };

static void lengths(Node* n, int d, std::array<int,256>& len){
    if(!n->l){ len[n->sym] = d?d:1; return; }
    lengths(n->l,d+1,len); lengths(n->r,d+1,len);
}
int main(){
    std::string text;
    const char* src = "the quick brown fox jumps over the lazy dog; "
                      "pack my box with five dozen liquor jugs. ";
    for(int i=0;i<80;i++) text += src;

    std::array<int,256> f{}; for(unsigned char c: text) f[c]++;
    double n=text.size(), H=0; for(int k: f) if(k){ double p=k/n; H -= p*log2(p); }

    // build Huffman tree
    std::priority_queue<Node*,std::vector<Node*>,Cmp> pq;
    std::vector<Node*> pool;
    for(int s=0;s<256;s++) if(f[s]){ pool.push_back(new Node{f[s],s}); pq.push(pool.back()); }
    while(pq.size()>1){ Node*a=pq.top();pq.pop(); Node*b=pq.top();pq.pop();
        pool.push_back(new Node{a->freq+b->freq,-1,a,b}); pq.push(pool.back()); }
    std::array<int,256> len{}; lengths(pq.top(),0,len);

    // Kraft equality check: sum 2^-len == 1 for a complete prefix code
    double kraft=0; for(int s=0;s<256;s++) if(len[s]) kraft += std::pow(2.0,-len[s]);

    // canonical codes from lengths alone (this is what DEFLATE transmits)
    std::vector<int> order; for(int s=0;s<256;s++) if(len[s]) order.push_back(s);
    std::sort(order.begin(),order.end(),[&](int a,int b){ return len[a]!=len[b]?len[a]<len[b]:a<b; });
    std::array<uint32_t,256> code{}; uint32_t c=0; int prev=len[order[0]];
    for(int s: order){ c <<= (len[s]-prev); prev=len[s]; code[s]=c++; }

    // encode
    std::vector<uint8_t> bits;
    for(unsigned char ch: text) for(int i=len[ch]-1;i>=0;--i) bits.push_back((code[ch]>>i)&1);

    // decode with a canonical-code first/count table
    std::array<int,33> cnt{}, first{}, base{};
    for(int s=0;s<256;s++) if(len[s]) cnt[len[s]]++;
    { uint32_t cc=0; int idx=0; std::array<int,33> firstidx{};
      for(int L=1;L<=32;L++){ cc<<=1; first[L]=cc; firstidx[L]=idx; cc+=cnt[L]; idx+=cnt[L]; base[L]=firstidx[L]; } }
    std::string out; uint32_t cur=0; int curlen=0; size_t pos=0;
    for(uint8_t b: bits){ cur=(cur<<1)|b; curlen++;
        if(cnt[curlen] && (int)cur - first[curlen] < cnt[curlen] && (int)cur>=first[curlen]){
            out += (char)order[base[curlen] + (cur-first[curlen])]; cur=0; curlen=0; }
    }
    (void)pos;
    double L_avg=0; for(int s=0;s<256;s++) if(f[s]) L_avg += (double)f[s]/n * len[s];
    printf("n=%zu symbols, alphabet=%zu\n", text.size(), order.size());
    printf("H(X)          = %.5f bit/sym\n", H);
    printf("Huffman L_avg = %.5f bit/sym\n", L_avg);
    printf("Kraft sum     = %.10f (must be exactly 1.0 for a complete prefix code)\n", kraft);
    printf("bound H <= L < H+1 : %s\n", (L_avg>=H-1e-12 && L_avg<H+1.0)?"HOLDS":"VIOLATED");
    printf("round trip    : %s (%zu bits = %zu bytes, vs %zu bytes raw)\n",
        out==text?"PASS":"FAIL", bits.size(), (bits.size()+7)/8, text.size());
    printf("code lengths  : ");
    for(int s: order) printf("%c:%d ", s==' '?'_':s, len[s]);
    printf("\n");

    // the integer-bit-length cost, made visible: a 2-symbol source
    printf("\n-- Huffman's floor: a two-symbol source, p vs cost --\n");
    for(double p : {0.5,0.6,0.7,0.8,0.9,0.95,0.99}){
        double h = -p*log2(p)-(1-p)*log2(1-p);
        printf("  p=%.2f  H=%.4f bit  Huffman=1.0000 bit  overhead=%.1f%%\n", p, h, 100*(1.0-h)/h);
    }
    return 0;
}
```

**Output (actual):**

```
n=6880 symbols, alphabet=29
H(X)          = 4.46100 bit/sym
Huffman L_avg = 4.52326 bit/sym
Kraft sum     = 1.0000000000 (must be exactly 1.0 for a complete prefix code)
bound H <= L < H+1 : HOLDS
round trip    : PASS (31120 bits = 3890 bytes, vs 6880 bytes raw)
code lengths  : _:2 e:4 i:4 o:4 b:5 c:5 f:5 h:5 j:5 p:5 r:5 s:5 t:5 u:5 y:5 z:5 a:6 d:6 g:6 k:6 l:6 m:6 n:6 q:6 v:6 w:6 x:6 .:7 ;:7 

-- Huffman's floor: a two-symbol source, p vs cost --
  p=0.50  H=1.0000 bit  Huffman=1.0000 bit  overhead=0.0%
  p=0.60  H=0.9710 bit  Huffman=1.0000 bit  overhead=3.0%
  p=0.70  H=0.8813 bit  Huffman=1.0000 bit  overhead=13.5%
  p=0.80  H=0.7219 bit  Huffman=1.0000 bit  overhead=38.5%
  p=0.90  H=0.4690 bit  Huffman=1.0000 bit  overhead=113.2%
  p=0.95  H=0.2864 bit  Huffman=1.0000 bit  overhead=249.2%
  p=0.99  H=0.0808 bit  Huffman=1.0000 bit  overhead=1137.7%
```

## 7.4 Arithmetic coding and rANS, both hitting the entropy

Supporting Unit 2. Two coders on the same skewed source, against the same entropy, with Huffman's cost for contrast.

Build: `-O2 -std=c++20`

```cpp
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <string>
#include <vector>
#include <array>
#include <random>

// ---------- classic binary arithmetic coder (CACM'87 shape, 32-bit) ----------
static const uint32_t HALF=0x80000000u, QTR=0x40000000u, TQ=0xC0000000u;
struct ACEnc {
    std::vector<uint8_t> bits; uint32_t low=0, high=0xFFFFFFFFu; uint64_t pending=0;
    void bit(int b){ bits.push_back(b); while(pending){ bits.push_back(!b); pending--; } }
    void encode(uint32_t cl, uint32_t ch, uint32_t tot){
        uint64_t range = (uint64_t)high - low + 1;
        high = low + (uint32_t)(range*ch/tot) - 1;
        low  = low + (uint32_t)(range*cl/tot);
        for(;;){
            if(high < HALF) bit(0);
            else if(low >= HALF){ bit(1); low-=HALF; high-=HALF; }
            else if(low>=QTR && high<TQ){ pending++; low-=QTR; high-=QTR; }
            else break;
            low<<=1; high=(high<<1)|1;
        }
    }
    void finish(){ pending++; if(low<QTR) bit(0); else bit(1); }
};
struct ACDec {
    const std::vector<uint8_t>& bits; size_t p=0; uint32_t low=0, high=0xFFFFFFFFu, val=0;
    ACDec(const std::vector<uint8_t>& b):bits(b){ for(int i=0;i<32;i++) val=(val<<1)|nb(); }
    int nb(){ return p<bits.size()? bits[p++] : 0; }
    uint32_t target(uint32_t tot){ uint64_t range=(uint64_t)high-low+1;
        return (uint32_t)((((uint64_t)(val-low)+1)*tot - 1)/range); }
    void update(uint32_t cl, uint32_t ch, uint32_t tot){
        uint64_t range=(uint64_t)high-low+1;
        high = low + (uint32_t)(range*ch/tot) - 1;
        low  = low + (uint32_t)(range*cl/tot);
        for(;;){
            if(high<HALF){}
            else if(low>=HALF){ low-=HALF; high-=HALF; val-=HALF; }
            else if(low>=QTR && high<TQ){ low-=QTR; high-=QTR; val-=QTR; }
            else break;
            low<<=1; high=(high<<1)|1; val=(val<<1)|nb();
        }
    }
};
// ---------- rANS, static model, 12-bit probabilities, 16-bit renorm ----------
static const uint32_t PB=12, M=1u<<PB, RL=1u<<16;
int main(){
    // A deliberately skewed source: Huffman must spend >= 1 bit/symbol, entropy is 0.4690.
    std::mt19937 rng(1234);
    std::string s; const int N=200000;
    for(int i=0;i<N;i++) s += (rng()%100 < 90) ? 'a' : 'b';
    std::array<uint32_t,256> f{}; for(unsigned char c: s) f[c]++;
    double H=0; for(uint32_t k: f) if(k){ double p=(double)k/N; H -= p*log2(p); }

    // quantised model, total = M
    std::array<uint32_t,257> cum{}; std::array<uint32_t,256> q{};
    { uint32_t used=0; int last=-1;
      for(int i=0;i<256;i++) if(f[i]){ q[i]=std::max(1u,(uint32_t)((uint64_t)f[i]*M/N)); used+=q[i]; last=i; }
      q[last] += M-used; }
    { uint32_t c=0; for(int i=0;i<256;i++){ cum[i]=c; c+=q[i]; } cum[256]=c; }

    // ---- arithmetic ----
    ACEnc e; for(unsigned char c: s) e.encode(cum[c], cum[c]+q[c], M); e.finish();
    ACDec d(e.bits); std::string back; back.reserve(N);
    for(int i=0;i<N;i++){ uint32_t t=d.target(M); int sym=0;
        while(cum[sym]+q[sym] <= t) sym++;
        back += (char)sym; d.update(cum[sym],cum[sym]+q[sym],M); }
    printf("source: %d symbols, P(a)=%.3f  H = %.5f bit/sym\n", N, (double)f['a']/N, H);
    printf("arithmetic : %zu bits = %.5f bit/sym  roundtrip %s\n",
        e.bits.size(), (double)e.bits.size()/N, back==s?"PASS":"FAIL");

    // ---- rANS ----
    std::vector<uint16_t> out;             // encoder emits backwards
    uint32_t x = RL;
    for(int i=N-1;i>=0;--i){ unsigned char c=s[i]; uint32_t fr=q[c];
        uint32_t xmax = ((RL>>PB)<<16)*fr;
        while(x >= xmax){ out.push_back((uint16_t)(x & 0xFFFF)); x >>= 16; }
        x = ((x/fr)<<PB) + (x%fr) + cum[c];
    }
    std::array<uint8_t,M> slot2sym{};
    for(int i=0;i<256;i++) for(uint32_t k=0;k<q[i];k++) slot2sym[cum[i]+k]=(uint8_t)i;
    std::string rback; rback.reserve(N);
    { uint32_t X=x; size_t p=out.size();
      for(int i=0;i<N;i++){
        uint32_t slot = X & (M-1); unsigned char c = slot2sym[slot]; rback += (char)c;
        X = q[c]*(X>>PB) + slot - cum[c];
        while(X < RL){ X = (X<<16) | (p? out[--p] : 0); }
      }
      printf("rANS       : %zu x16bit + 32bit state = %.5f bit/sym  roundtrip %s\n",
        out.size(), (out.size()*16.0+32)/N, rback==s?"PASS":"FAIL");
    }
    printf("Huffman on this source would cost exactly 1.00000 bit/sym (2 symbols -> 1 bit each)\n");
    printf("arithmetic beats Huffman by %.1f%%\n", 100.0*(1.0-(double)e.bits.size()/N)/1.0);
    return 0;
}
```

**Output (actual):**

```
source: 200000 symbols, P(a)=0.899  H = 0.47315 bit/sym
arithmetic : 94631 bits = 0.47315 bit/sym  roundtrip PASS
rANS       : 5914 x16bit + 32bit state = 0.47328 bit/sym  roundtrip PASS
Huffman on this source would cost exactly 1.00000 bit/sym (2 symbols -> 1 bit each)
arithmetic beats Huffman by 52.7%
```

## 7.5 LZ77 match finding, and the Burrows-Wheeler transform

Unit 2, Exercise 4 and its extension.

Build: `-O2 -std=c++20`

```cpp
#include <cstdio>
#include <cstdint>
#include <string>
#include <vector>
#include <array>
#include <algorithm>
#include <numeric>

// ---- LZ77 with a DEFLATE-shaped window: 32 KiB, matches 3..258, hash chains on 3-byte prefixes
struct Tok { bool lit; uint8_t ch; uint32_t dist, len; };
static std::vector<Tok> lz77(const std::string& s, int max_chain=128){
    const uint32_t WIN=32768, MINM=3, MAXM=258, HB=15, HSZ=1u<<HB;
    std::vector<int32_t> head(HSZ,-1), prev(s.size(),-1);
    auto h3=[&](size_t i){ return (uint32_t)(((uint8_t)s[i]*0x9E3779B1u ^ (uint8_t)s[i+1]*0x85EBCA6Bu ^ (uint8_t)s[i+2]*0xC2B2AE35u)>>(32-HB)) & (HSZ-1); };
    std::vector<Tok> out; size_t i=0;
    while(i<s.size()){
        uint32_t best=0, bestd=0;
        if(i+MINM<=s.size()){
            uint32_t hh=h3(i);
            int32_t c=head[hh]; int chain=max_chain;
            while(c>=0 && chain-- && (uint32_t)(i-c)<=WIN){
                uint32_t l=0; while(l<MAXM && i+l<s.size() && s[c+l]==s[i+l]) l++;
                if(l>best){ best=l; bestd=(uint32_t)(i-c); if(l==MAXM) break; }
                c=prev[c];
            }
        }
        if(best>=MINM){
            for(uint32_t k=0;k<best;k++) if(i+k+MINM<=s.size()){ uint32_t hh=h3(i+k); prev[i+k]=head[hh]; head[hh]=(int32_t)(i+k); }
            out.push_back({false,0,bestd,best}); i+=best;
        } else {
            if(i+MINM<=s.size()){ uint32_t hh=h3(i); prev[i]=head[hh]; head[hh]=(int32_t)i; }
            out.push_back({true,(uint8_t)s[i],0,0}); i++;
        }
    }
    return out;
}
static std::string unlz77(const std::vector<Tok>& t){
    std::string o;
    for(auto&k:t){ if(k.lit) o+=(char)k.ch; else { size_t st=o.size()-k.dist; for(uint32_t j=0;j<k.len;j++) o+=o[st+j]; } }
    return o;
}
// ---- BWT (naive O(n^2 log n) via rotation sort; fine for teaching sizes)
static std::pair<std::string,size_t> bwt(const std::string& s){
    size_t n=s.size(); std::vector<size_t> idx(n); std::iota(idx.begin(),idx.end(),0);
    std::string ss=s+s;
    std::sort(idx.begin(),idx.end(),[&](size_t a,size_t b){ return ss.compare(a,n,ss,b,n)<0; });
    std::string L(n,0); size_t prim=0;
    for(size_t i=0;i<n;i++){ L[i]=s[(idx[i]+n-1)%n]; if(idx[i]==0) prim=i; }
    return {L,prim};
}
static std::string ibwt(const std::string& L, size_t prim){
    size_t n=L.size(); std::array<int,257> cnt{};
    for(unsigned char c:L) cnt[c+1]++;
    for(int i=0;i<256;i++) cnt[i+1]+=cnt[i];
    std::vector<int> next(n); std::array<int,256> off{}; for(int i=0;i<256;i++) off[i]=cnt[i];
    for(size_t i=0;i<n;i++) next[off[(unsigned char)L[i]]++]=(int)i;
    std::string out; out.reserve(n); size_t p=next[prim];
    for(size_t i=0;i<n;i++){ out+=L[p]; p=next[p]; }
    return out;
}
static double runs_per_byte(const std::string& s){ size_t r=1; for(size_t i=1;i<s.size();i++) if(s[i]!=s[i-1]) r++; return (double)r/s.size(); }
int main(){
    std::string text; const char* p="the rain in spain falls mainly on the plain. ";
    for(int i=0;i<150;i++) text+=p;
    auto t=lz77(text);
    size_t lits=0, matches=0, mlen=0;
    for(auto&k:t){ if(k.lit) lits++; else { matches++; mlen+=k.len; } }
    // crude cost model: literal 9 bits, match 24 bits (len+dist), as a lower-bound sanity figure
    double bits = lits*9.0 + matches*24.0;
    printf("LZ77 on %zu bytes: %zu literals, %zu matches (avg len %.1f), coverage %.1f%%\n",
        text.size(), lits, matches, matches?(double)mlen/matches:0.0, 100.0*mlen/text.size());
    printf("  roundtrip %s ; naive-cost %.0f bytes (%.2fx)\n",
        unlz77(t)==text?"PASS":"FAIL", bits/8, text.size()/(bits/8));
    printf("  first 6 tokens: ");
    for(int i=0;i<6 && i<(int)t.size();i++) t[i].lit?printf("lit'%c' ",t[i].ch):printf("<%u,%u> ",t[i].dist,t[i].len);
    printf("\n");

    std::string small = "banana";
    auto [L,prim] = bwt(small);
    printf("\nBWT(\"banana\") = \"%s\" primary index %zu ; inverse = \"%s\" %s\n",
        L.c_str(), prim, ibwt(L,prim).c_str(), ibwt(L,prim)==small?"PASS":"FAIL");
    std::string big = text.substr(0,4000);
    auto [L2,p2]=bwt(big);
    printf("BWT on 4000 bytes of the same text: runs/byte before %.4f -> after %.4f (%.1fx fewer runs)\n",
        runs_per_byte(big), runs_per_byte(L2), runs_per_byte(big)/runs_per_byte(L2));
    printf("  inverse roundtrip %s\n", ibwt(L2,p2)==big?"PASS":"FAIL");
    printf("  BWT output head: \"%.60s\"\n", L2.c_str());
    return 0;
}
```

**Output (actual):**

```
LZ77 on 6750 bytes: 27 literals, 32 matches (avg len 210.1), coverage 99.6%
  roundtrip PASS ; naive-cost 126 bytes (53.41x)
  first 6 tokens: lit't' lit'h' lit'e' lit' ' lit'r' lit'a' 

BWT("banana") = "nnbaaa" primary index 3 ; inverse = "banana" PASS
BWT on 4000 bytes of the same text: runs/byte before 0.9778 -> after 0.0088 (111.7x fewer runs)
  inverse roundtrip PASS
  BWT output head: "nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn"
```

## 7.6 JPEG's DCT and quantisation, and the same pipeline on neural-network weights

Supporting Unit 2's lossy section and the FP4 connection in §3.5.

Build: `-O2 -std=c++20`

```cpp
#include <cstdio>
#include <cmath>
#include <cstdint>
#include <vector>
#include <random>
#include <algorithm>
// JPEG luminance quantisation table, ITU-T T.81 Annex K, Table K.1
static const int Q50[64]={
 16,11,10,16,24,40,51,61, 12,12,14,19,26,58,60,55, 14,13,16,24,40,57,69,56, 14,17,22,29,51,87,80,62,
 18,22,37,56,68,109,103,77, 24,35,55,64,81,104,113,92, 49,64,78,87,103,121,120,101, 72,92,95,98,112,100,103,99};
static void dct8x8(const double in[64], double out[64]){
    for(int u=0;u<8;u++) for(int v=0;v<8;v++){
        double s=0;
        for(int x=0;x<8;x++) for(int y=0;y<8;y++)
            s += in[x*8+y]*cos((2*x+1)*u*M_PI/16)*cos((2*y+1)*v*M_PI/16);
        double cu=u?1:1/sqrt(2.0), cv=v?1:1/sqrt(2.0);
        out[u*8+v]=0.25*cu*cv*s; }
}
static void idct8x8(const double in[64], double out[64]){
    for(int x=0;x<8;x++) for(int y=0;y<8;y++){
        double s=0;
        for(int u=0;u<8;u++) for(int v=0;v<8;v++){
            double cu=u?1:1/sqrt(2.0), cv=v?1:1/sqrt(2.0);
            s += cu*cv*in[u*8+v]*cos((2*x+1)*u*M_PI/16)*cos((2*y+1)*v*M_PI/16); }
        out[x*8+y]=0.25*s; }
}
// --- FP4 E2M1 codec (the same "transform, quantise, entropy-code" shape, minus the transform)
static const double E2M1[8]={0,0.5,1,1.5,2,3,4,6};
static double q_e2m1(double v){ double a=fabs(v),best=0,bd=1e30;
    for(double c: E2M1){ double d=fabs(a-c); if(d<bd){bd=d;best=c;} } return v<0?-best:best; }
int main(){
    // a smooth-ish 8x8 block, level-shifted to [-128,127] like JPEG does
    double blk[64], rec[64], co[64], deq[64];
    for(int x=0;x<8;x++) for(int y=0;y<8;y++) blk[x*8+y] = 80*sin(x*0.6)+50*cos(y*0.4)+3*((x*7+y*13)%5) - 128 + 128;
    dct8x8(blk,co);
    printf("energy compaction: DC coeff = %.1f ; |coeff| sorted, top 8:", co[0]);
    { std::vector<double> a; for(int i=0;i<64;i++) a.push_back(fabs(co[i]));
      std::sort(a.rbegin(),a.rend()); for(int i=0;i<8;i++) printf(" %.1f",a[i]);
      double tot=0,top8=0; for(int i=0;i<64;i++) tot+=a[i]*a[i]; for(int i=0;i<8;i++) top8+=a[i]*a[i];
      printf("\n  top-8 coefficients hold %.2f%% of the block energy\n", 100*top8/tot); }
    printf("\nquality  scale  nonzero-coeffs  RMSE\n");
    for(int qual: {95,75,50,25,10}){
        double S = qual<50 ? 5000.0/qual : 200.0-2.0*qual;   // the libjpeg scaling rule
        int nz=0;
        for(int i=0;i<64;i++){
            double q = std::clamp(std::floor((Q50[i]*S+50)/100.0),1.0,255.0);
            double lvl = std::round(co[i]/q); if(lvl!=0) nz++;
            deq[i]=lvl*q; }
        idct8x8(deq,rec);
        double se=0; for(int i=0;i<64;i++){ double d=rec[i]-blk[i]; se+=d*d; }
        printf("  %3d   %5.1f%%      %2d/64        %.3f\n", qual, S, nz, sqrt(se/64));
    }
    // --- the same pipeline on a "weight block": no transform, block scale, 4-bit quantise
    std::mt19937 rng(5); std::normal_distribution<double> nd(0,1);
    printf("\n-- neural-net weight quantisation is the same three steps, different transform --\n");
    for(int outlier: {0,1}){
        double w[16]; for(auto&x:w) x=nd(rng);
        if(outlier) w[7]*=12.0;
        double amax=0; for(double x:w) amax=std::max(amax,fabs(x));
        double scale=amax/6.0;                       // land block amax on E2M1's max, 6.0
        double se=0,sig=0; for(int i=0;i<16;i++){ double r=q_e2m1(w[i]/scale)*scale; se+=(r-w[i])*(r-w[i]); sig+=w[i]*w[i]; }
        printf("  block of 16, %-11s amax=%6.3f scale=%6.4f  SQNR=%6.2f dB\n",
            outlier?"WITH outlier":"no outlier", amax, scale, 10*log10(sig/se));
    }
    return 0;
}
```

**Output (actual):**

```
energy compaction: DC coeff = 247.5 ; |coeff| sorted, top 8: 307.1 281.9 247.5 247.2 48.4 31.5 23.1 13.5
  top-8 coefficients hold 99.59% of the block energy

quality  scale  nonzero-coeffs  RMSE
   95    10.0%      31/64        1.923
   75    50.0%      10/64        4.111
   50   100.0%       8/64        4.938
   25   200.0%       7/64        5.057
   10   500.0%       5/64        8.188

-- neural-net weight quantisation is the same three steps, different transform --
  block of 16, no outlier  amax= 3.286 scale=0.5477  SQNR= 26.50 dB
  block of 16, WITH outlier amax= 6.828 scale=1.1380  SQNR= 22.25 dB
```

## 7.7 Hamming(7,4) exhaustively, and SECDED

Unit 3, Exercise 7.

Build: `-O2 -std=c++20`

```cpp
#include <cstdio>
#include <cstdint>
#include <bitset>
// Hamming(7,4), bit positions 1..7; parity bits at powers of two (1,2,4), data at 3,5,6,7.
static uint8_t encode(uint8_t d){          // d = d1 d2 d3 d4 in bits 0..3
    int b[8]={0};
    b[3]=(d>>0)&1; b[5]=(d>>1)&1; b[6]=(d>>2)&1; b[7]=(d>>3)&1;
    b[1]=b[3]^b[5]^b[7];
    b[2]=b[3]^b[6]^b[7];
    b[4]=b[5]^b[6]^b[7];
    uint8_t c=0; for(int i=1;i<=7;i++) c |= b[i]<<(i-1);
    return c;
}
static int syndrome(uint8_t c){
    int b[8]={0}; for(int i=1;i<=7;i++) b[i]=(c>>(i-1))&1;
    int s1=b[1]^b[3]^b[5]^b[7], s2=b[2]^b[3]^b[6]^b[7], s4=b[4]^b[5]^b[6]^b[7];
    return s1 | (s2<<1) | (s4<<2);   // == index of the flipped bit, or 0
}
static uint8_t decode_data(uint8_t c){
    int s=syndrome(c); if(s) c ^= 1u<<(s-1);
    int b[8]={0}; for(int i=1;i<=7;i++) b[i]=(c>>(i-1))&1;
    return b[3] | (b[5]<<1) | (b[6]<<2) | (b[7]<<3);
}
int main(){
    // 1. exhaustive single-error correction: 16 data words x 7 flip positions
    int ok=0;
    for(int d=0; d<16; ++d){
        uint8_t c=encode(d);
        if(decode_data(c)!=d) { printf("clean decode FAIL d=%d\n",d); }
        for(int p=0;p<7;++p){
            uint8_t r = c ^ (1u<<p);
            if(syndrome(r) != p+1) printf("syndrome FAIL d=%d p=%d s=%d\n",d,p,syndrome(r));
            if(decode_data(r)==d) ok++;
            else printf("correct FAIL d=%d p=%d\n",d,p);
        }
    }
    printf("single-bit correction: %d / 112 corrected\n", ok);

    // 2. minimum Hamming distance of the code
    int dmin=99; for(int a=0;a<16;a++) for(int b=a+1;b<16;b++){
        int dist=std::bitset<8>(encode(a)^encode(b)).count(); if(dist<dmin) dmin=dist; }
    printf("d_min of Hamming(7,4) = %d  (corrects floor((d-1)/2)=%d, detects d-1=%d)\n", dmin, (dmin-1)/2, dmin-1);

    // 3. double errors are MIS-corrected (the whole reason SECDED exists)
    int mis=0, tot=0;
    for(int d=0; d<16; ++d){ uint8_t c=encode(d);
        for(int p=0;p<7;p++) for(int q=p+1;q<7;q++){ tot++; if(decode_data(c^(1u<<p)^(1u<<q))!=d) mis++; } }
    printf("double-bit errors: %d/%d silently decoded to the WRONG word\n", mis, tot);

    // 4. SECDED = Hamming(8,4): add an overall parity bit -> d_min 4
    auto enc8=[](int d){ uint8_t c=encode(d); int par=std::bitset<8>(c).count()&1; return (uint8_t)(c | (par<<7)); };
    int dmin8=99; for(int a=0;a<16;a++) for(int b=a+1;b<16;b++){
        int dist=std::bitset<8>(enc8(a)^enc8(b)).count(); if(dist<dmin8) dmin8=dist; }
    int detected2=0, tot2=0;
    for(int d=0;d<16;d++){ uint8_t c=enc8(d);
      for(int p=0;p<8;p++) for(int q=p+1;q<8;q++){ tot2++;
        uint8_t r=c^(1u<<p)^(1u<<q);
        int s=syndrome(r & 0x7F);
        int overall=std::bitset<8>(r).count()&1;
        // s != 0 and overall parity even  => 2-bit error detected, uncorrectable (DED)
        if(s!=0 && overall==0) detected2++;
      } }
    printf("SECDED(8,4): d_min=%d, double errors flagged uncorrectable: %d/%d\n", dmin8, detected2, tot2);
    return 0;
}
```

**Output (actual):**

```
single-bit correction: 112 / 112 corrected
d_min of Hamming(7,4) = 3  (corrects floor((d-1)/2)=1, detects d-1=2)
double-bit errors: 336/336 silently decoded to the WRONG word
SECDED(8,4): d_min=4, double errors flagged uncorrectable: 448/448
```

## 7.8 Reed-Solomon erasure recovery over GF(256), exhaustively

Unit 3, Exercise 8. Both the polynomial-interpolation view and the systematic Cauchy-matrix view.

Build: `-O2 -std=c++20`

```cpp
#include <cstdio>
#include <cstdint>
#include <vector>
#include <array>
#include <string>
#include <random>
// GF(2^8) with primitive polynomial 0x11D = x^8+x^4+x^3+x^2+1 (QR codes, CD, most RS libs)
static uint8_t EXP[512], LOG[256];
static void gf_init(){ int x=1; for(int i=0;i<255;i++){ EXP[i]=(uint8_t)x; LOG[x]=(uint8_t)i;
        x<<=1; if(x&0x100) x^=0x11D; } for(int i=255;i<512;i++) EXP[i]=EXP[i-255]; }
static inline uint8_t gmul(uint8_t a,uint8_t b){ return (!a||!b)?0:EXP[LOG[a]+LOG[b]]; }
static inline uint8_t gdiv(uint8_t a,uint8_t b){ return !a?0:EXP[LOG[a]+255-LOG[b]]; }
static inline uint8_t ginv(uint8_t a){ return EXP[255-LOG[a]]; }

// ---- View 1: RS as oversampling a polynomial ----
// data d0..d_{k-1} are the COEFFICIENTS of P(x); shard i = P(alpha_i) for n distinct alpha_i.
static std::vector<uint8_t> rs_encode_poly(const std::vector<uint8_t>& d, int n){
    std::vector<uint8_t> out(n);
    for(int i=0;i<n;i++){ uint8_t x=(uint8_t)(i+1), acc=0;      // alpha_i = 1..n, all distinct, nonzero
        for(int j=(int)d.size()-1;j>=0;--j) acc = (uint8_t)(gmul(acc,x) ^ d[j]);
        out[i]=acc; }
    return out;
}
// Lagrange interpolation at x=0..k-1 coefficients: recover coefficients from k (point,value) pairs.
static std::vector<uint8_t> lagrange_coeffs(const std::vector<uint8_t>& xs, const std::vector<uint8_t>& ys){
    int k=(int)xs.size(); std::vector<uint8_t> res(k,0);
    for(int i=0;i<k;i++){
        // basis poly L_i(x) = prod_{j!=i} (x - xj)/(xi - xj)   (subtraction == XOR)
        std::vector<uint8_t> num(1,1); uint8_t den=1;
        for(int j=0;j<k;j++) if(j!=i){
            num.push_back(0);
            for(int t=(int)num.size()-1;t>0;--t) num[t]=(uint8_t)(num[t-1] ^ gmul(num[t],xs[j]));
            num[0]=gmul(num[0],xs[j]);
            den = gmul(den, (uint8_t)(xs[i]^xs[j]));
        }
        uint8_t sc = gdiv(ys[i], den);
        for(int t=0;t<k;t++) res[t]^= gmul(num[t], sc);
    }
    return res;
}
// ---- View 2: systematic erasure code with a Cauchy parity matrix + Gaussian elimination ----
static bool solve(std::vector<std::vector<uint8_t>> A, std::vector<uint8_t> b, std::vector<uint8_t>& x){
    int k=(int)b.size();
    for(int c=0;c<k;c++){
        int p=-1; for(int r=c;r<k;r++) if(A[r][c]){p=r;break;}
        if(p<0) return false;
        std::swap(A[p],A[c]); std::swap(b[p],b[c]);
        uint8_t iv=ginv(A[c][c]);
        for(int j=0;j<k;j++) A[c][j]=gmul(A[c][j],iv); b[c]=gmul(b[c],iv);
        for(int r=0;r<k;r++) if(r!=c && A[r][c]){ uint8_t f=A[r][c];
            for(int j=0;j<k;j++) A[r][j]^=gmul(f,A[c][j]); b[r]^=gmul(f,b[c]); }
    }
    x=b; return true;
}
int main(){
    gf_init();
    printf("GF(256): 3*7=%d, 0x53*0xCA=%d, inv(0x53)*0x53=%d (must be 1)\n",
        gmul(3,7), gmul(0x53,0xCA), gmul(ginv(0x53),0x53));

    // --- polynomial view, k=4 data, n=8 shards, exhaustive over ALL C(8,4)=70 survivor sets ---
    const int k=4, n=8;
    std::vector<uint8_t> data{ 'D','A','T','A' };
    auto shards = rs_encode_poly(data, n);
    printf("k=%d data bytes, n=%d shards; shard values:", k, n);
    for(uint8_t s: shards) printf(" %02X", s); printf("\n");
    int sets=0, okc=0;
    for(int mask=0; mask<(1<<n); ++mask){
        if(__builtin_popcount(mask)!=k) continue;
        std::vector<uint8_t> xs, ys;
        for(int i=0;i<n;i++) if(mask>>i&1){ xs.push_back((uint8_t)(i+1)); ys.push_back(shards[i]); }
        auto rec = lagrange_coeffs(xs,ys);
        sets++; if(rec==data) okc++; else printf("  FAIL mask=%02X\n", mask);
    }
    printf("polynomial view: recovered original from %d / %d possible 4-of-8 survivor sets\n", okc, sets);

    // --- systematic Cauchy, k=6 data + m=3 parity, exhaustive over all C(9,6)=84 sets ---
    const int K=6, Mp=3, N=K+Mp;
    // Cauchy: A[i][j] = 1/(x_i ^ y_j), x_i and y_j disjoint sets => every square submatrix invertible
    uint8_t xr[Mp]={100,101,102}, yc[K]={1,2,3,4,5,6};
    std::vector<std::vector<uint8_t>> G(N, std::vector<uint8_t>(K,0));
    for(int i=0;i<K;i++) G[i][i]=1;                              // systematic part
    for(int i=0;i<Mp;i++) for(int j=0;j<K;j++) G[K+i][j]=ginv((uint8_t)(xr[i]^yc[j]));
    std::mt19937 rng(99); std::vector<uint8_t> D(K); for(auto&d:D) d=(uint8_t)(rng()&0xFF);
    std::vector<uint8_t> S(N,0);
    for(int i=0;i<N;i++){ uint8_t a=0; for(int j=0;j<K;j++) a^=gmul(G[i][j],D[j]); S[i]=a; }
    int sets2=0, ok2=0, sing=0;
    for(int mask=0; mask<(1<<N); ++mask){
        if(__builtin_popcount(mask)!=K) continue;
        std::vector<std::vector<uint8_t>> A; std::vector<uint8_t> b;
        for(int i=0;i<N;i++) if(mask>>i&1){ A.push_back(G[i]); b.push_back(S[i]); }
        std::vector<uint8_t> x; sets2++;
        if(!solve(A,b,x)){ sing++; continue; }
        if(x==D) ok2++; else printf("  systematic FAIL mask=%03X\n", mask);
    }
    printf("systematic Cauchy RS(9,6): recovered from %d / %d survivor sets, %d singular\n", ok2, sets2, sing);
    printf("  (this is RAID-6-shaped: tolerate any %d of %d shard losses)\n", Mp, N);

    // one shard loss must NOT be recoverable if k-1 survive:
    { std::vector<uint8_t> xs,ys; for(int i=0;i<k-1;i++){ xs.push_back((uint8_t)(i+1)); ys.push_back(shards[i]); }
      auto r=lagrange_coeffs(xs,ys);
      printf("with only k-1=%d shards the interpolated polynomial is degree %d and does NOT match: %s\n",
        k-1,k-2, r==data?"UNEXPECTED MATCH":"correct, unrecoverable"); }
    return 0;
}
```

**Output (actual):**

```
GF(256): 3*7=9, 0x53*0xCA=143, inv(0x53)*0x53=1 (must be 1)
k=4 data bytes, n=8 shards; shard values: 10 B9 76 F9 D0 A8 1A CE
polynomial view: recovered original from 70 / 70 possible 4-of-8 survivor sets
systematic Cauchy RS(9,6): recovered from 84 / 84 survivor sets, 0 singular
  (this is RAID-6-shaped: tolerate any 3 of 9 shard losses)
with only k-1=3 shards the interpolated polynomial is degree 2 and does NOT match: correct, unrecoverable
```

## 7.9 The birthday bound, avalanche, and FNV-1a's clustering

Unit 3, Exercise 9.

Build: `-O2 -std=c++20`

```cpp
#include <cstdio>
#include <cstdint>
#include <cmath>
#include <unordered_map>
#include <vector>
#include <string>
#include <random>
#include <bitset>
static uint64_t fnv1a(const void* p, size_t n){ const uint8_t* b=(const uint8_t*)p;
    uint64_t h=1469598103934665603ull; for(size_t i=0;i<n;i++){ h^=b[i]; h*=1099511628211ull; } return h; }
static uint64_t splitmix(uint64_t x){ x+=0x9E3779B97F4A7C15ull;
    x=(x^(x>>30))*0xBF58476D1CE4E5B9ull; x=(x^(x>>27))*0x94D049BB133111EBull; return x^(x>>31); }
int main(){
    // --- birthday bound: expected first collision at ~sqrt(pi/2 * 2^b) for a b-bit hash
    printf("bits   theory sqrt(pi/2*2^b)   measured (mean of 200 trials)\n");
    for(int bits: {16,20,24,28}){
        uint64_t mask=(1ull<<bits)-1; double tot=0;
        for(int t=0;t<200;t++){
            std::unordered_map<uint64_t,int> seen; uint64_t i=0;
            std::mt19937_64 rng(t*7919+1);
            for(;;i++){ uint64_t h = splitmix(rng()) & mask; if(seen.count(h)) break; seen[h]=1; }
            tot += (double)(i+1);
        }
        printf("%3d      %14.1f   %14.1f\n", bits, sqrt(M_PI/2*pow(2.0,bits)), tot/200);
    }
    // --- avalanche: flipping one input bit should flip ~half the output bits
    { std::mt19937_64 rng(1); double sum=0; int n=0;
      for(int t=0;t<20000;t++){ uint64_t v=rng(); int b=rng()%64;
        uint64_t a=splitmix(v), c=splitmix(v^(1ull<<b));
        sum += std::bitset<64>(a^c).count(); n++; }
      printf("\nsplitmix64 avalanche: mean output bits flipped per single input-bit flip = %.3f / 64 (ideal 32)\n", sum/n); }
    { std::mt19937_64 rng(1); double sum=0; int n=0;
      for(int t=0;t<20000;t++){ uint64_t v=rng(); int b=rng()%64; uint64_t w=v^(1ull<<b);
        uint64_t a=fnv1a(&v,8), c=fnv1a(&w,8);
        sum += std::bitset<64>(a^c).count(); n++; }
      printf("FNV-1a     avalanche: mean output bits flipped per single input-bit flip = %.3f / 64 (ideal 32)\n", sum/n); }
    // --- FNV-1a on short similar strings: the classic weakness
    { printf("\nFNV-1a low 16 bits of \"key0000\"..\"key0015\": ");
      for(int i=0;i<16;i++){ char b[16]; snprintf(b,sizeof b,"key%04d",i); printf("%04llX ",(unsigned long long)(fnv1a(b,7)&0xFFFF)); }
      printf("\n"); }
    return 0;
}
```

**Output (actual):**

```
bits   theory sqrt(pi/2*2^b)   measured (mean of 200 trials)
 16               320.8            320.6
 20              1283.4           1235.4
 24              5133.6           5128.0
 28             20534.3          20296.5

splitmix64 avalanche: mean output bits flipped per single input-bit flip = 31.997 / 64 (ideal 32)
FNV-1a     avalanche: mean output bits flipped per single input-bit flip = 25.619 / 64 (ideal 32)

FNV-1a low 16 bits of "key0000".."key0015": 27BA 296D 2454 2607 20EE 22A1 1D88 1F3B 1A22 1BD5 0AE3 0930 0E49 0C96 11AF 0FFC 
```

---

# 8. Unverified, uncertain, or flagged

Read this before teaching anything above. Ordered by how much it would hurt to be wrong.

## Would mislead a student if wrong

1. **The Shannon 1951 English-entropy figures** (`F₀ ≈ 4.76`, `F₁ ≈ 4.03`, `F₂ ≈ 3.32`, `F₃ ≈ 3.1`,
   and the 0.6–1.3 bits/char gambling-experiment range) are **recalled, not re-verified**. The
   paper (*"Prediction and Entropy of Printed English"*, BSTJ 30(1), 1951) was not fetched. The
   *shape* of the result — order-0 around 4, long-context around 1 — is certain; the exact decimals
   should be checked against the paper before printing them on a slide. My own measurements
   (4.130 order-0, 2.820 order-1) are verified but are estimates from a small sample and the
   order-1 figure is **biased low** by the plug-in estimator; do not present it as "the entropy of
   English".

2. **Koopman's CRC Hamming-distance length thresholds** — CRC-32/ISO-HDLC achieving HD=4 up to
   ~91,607 bits and HD=6 up to ~268 bits, CRC-32C achieving HD=6 up to ~5,243 bits — are
   **recalled from the literature and not verified here**. What *is* verified (§7.2b) is the
   underlying algebra: the term counts, `G(1)`, the `(x+1)` divisibility, and the multiplicative
   order of `x`. Prefer teaching the verified algebra and citing Koopman's tables as a reference
   rather than restating the numbers as fact. Koopman's CRC Zoo
   (`users.ece.cmu.edu/~koopman/crc/`) is the authority.

3. **DDR5 on-die ECC being "SEC over 128 data bits with 8 check bits"** is
   **vendor-consensus, not primary-verified**. JEDEC JESD79-5 is paywalled; the Micron white paper
   redirected to an asset host that returned "Request Rejected"; the Synopsys RAS bulletin 404'd
   and the Rambus primer 404'd; Semiconductor Engineering returned 403. The *architectural* claims
   in §4.9 — that on-die ECC is internal to the die, has no host reporting path, is present on all
   DDR5 including non-ECC modules, and does **not** make a non-ECC DIMM an ECC DIMM — are
   uncontroversial and stated by every vendor. The specific `(136,128)` geometry and the ECS
   details should be checked against JESD79-5 by someone with access before being taught as spec.

4. **The DeepMind "Language Modeling Is Compression" figures** (Chinchilla-70B as an
   arithmetic-coding model reaching ~43.4% on ImageNet patches vs PNG's ~58.5%, and ~16.4% on
   LibriSpeech vs FLAC's ~30.3%) are **recalled, not fetched**. The *claim* — that a large language
   model used as the probability model for an arithmetic coder is a state-of-the-art general-purpose
   compressor, including out of its training domain — is well established and is the correct thing
   to teach. The percentages should be re-checked against arXiv:2309.10668 before quoting.

5. **The 10,000-GPU HBM error-rate arithmetic in §4.10** is a deliberately rough
   order-of-magnitude extrapolation of the Google DDR2/DDR3 field-study rate to HBM3, and is
   labelled as such in the text. **Do not quote the absolute number.** HBM is a different
   technology with different failure characteristics, the study's own finding was that errors
   concentrate in a minority of bad devices, and no comparable public HBM field study was located.
   The Llama 3 table (verified, fetched) is the number to teach; the extrapolation is only there to
   motivate it.

## Numbers I could not source or fully verify

6. **The claim that video is 65–80% of consumer internet traffic** (§3.3) is directionally right
   and universally repeated, but the underlying reports (Sandvine, Cisco VNI) are of varying
   quality, differently defined, and increasingly old. State it as "most" rather than with a
   percentage.

7. **The Silesia-corpus benchmark table in §2.8** is quoted from the zstd README as fetched, on
   *its* hardware (i7-9700K @ 4.9 GHz, Ubuntu 24.04, lzbench, gcc 14.2). It was **not reproduced
   here** — only zlib was available in the sandbox. Ratios on other corpora differ substantially,
   which is precisely the point §2.13 makes. Re-fetch before teaching; the table is version-pinned
   and will change.

8. **`zlibVersion()` reported `"1.3"`** in the sandbox while the library catalogue lists
   `zlib 1.3.1`. Cosmetic, but if an exercise asserts on the version string it will fail.

9. **x264's "tens of thousands of lines of hand-written assembly"** (§3.3) is an order-of-magnitude
   recollection, not a line count I ran. The qualitative claim is safe; if you want a number, count
   `x264/common/x86/*.asm` yourself.

10. **The CD/CIRC "corrects a ~2.5 mm scratch"** figure is the standard textbook number and was not
    re-derived. The RS(32,28)/RS(28,24) parameters are standard and reliable.

11. **AMD Ryzen's unofficial ECC support** varies by board, BIOS, and CPU model, and the situation
    changes. Treat §4.7's remark as illustrative, not as purchasing advice.

## Things that are genuinely contested or will change

12. **Rowhammer mitigations.** Every in-DRAM mitigation shipped so far (TRR, and its per-vendor
    variants) has been broken — TRRespass in 2020, Blacksmith in 2021. DDR5's RFM and per-row
    activation counting are the current answer and there is active published work probing them.
    Anything §4.8 says about *current* mitigation status has a short half-life. The *structural*
    lesson — a code designed for a random error model does not defend against an adversary — does
    not.

13. **"Should desktops have ECC"** is a genuine argument, not a settled fact. The field-study
    numbers are strong; the counter-argument (cost, latency, and that consumer workloads tolerate
    rare corruption) is not absurd. Present both.

14. **Whether the entropy-coding step should stay omitted in NN quantisation** (§3.5) is an open
    research question, not settled engineering. There is active work on entropy-coded weight
    formats with fast random access. The *reason* it is currently omitted — fixed-rate buys random
    access at GEMM speed — is solid and is the durable part of the lesson.

15. **Compiler Explorer's library catalogue and compiler ids** (`g152` = GCC 15.2, `zlib 1.3.1`)
    will move. Any exercise harness should query `https://godbolt.org/api/compilers/c++` and
    `https://godbolt.org/api/libraries/c++` rather than hard-coding, or pin and expect breakage.

## Deliberate simplifications in the exercise code

16. The **BWT implementation in §7.5 sorts rotations with `O(n log n)` comparisons of `O(n)` cost**
    — fine at the 4 KB teaching scale, useless at real scale. Real implementations use suffix-array
    construction (SA-IS, DC3) in `O(n)`. Flag it to students rather than letting them benchmark it
    and conclude the BWT is slow.

17. The **DCT in §7.6 is the naive `O(n⁴)` double loop** over an 8×8 block. Real JPEG uses the
    AAN or Loeffler fast DCT (11 multiplies, 29 adds for an 8-point 1-D DCT). Correct, not fast.

18. The **LZ77 in §7.5 uses a greedy parse with a bounded hash chain** and a crude 9-bits-per-literal
    / 24-bits-per-match cost model. Real DEFLATE uses lazy matching and Huffman-coded lengths and
    distances, so the reported "naive-cost bytes" figure is an illustration, not a prediction of
    gzip's output.

19. The **outlier demonstration in §7.6** (26.50 dB → 22.25 dB SQNR) uses a weak outlier — one
    normal sample multiplied by 12, which happened to land at 6.8× the block RMS. A realistic
    activation outlier is far more extreme and the SQNR collapse is correspondingly worse. Tune the
    multiplier up before using it to make the point forcefully; `fp4-fp8-blackwell.md` §2 has the
    real measurements.

20. The **`solve()` Gaussian elimination in §7.8** does full reduction with no partial-pivot
    optimisation and rebuilds the matrix per subset — `O(k³)` per recovery, which is correct and
    irrelevant at `k=6`. ISA-L and Jerasure use precomputed inverse tables and SIMD `GF` multiply
    (`VPSHUFB`-based split-table multiply) and run at many GB/s.

---

# 9. Sources

## Fetched and quoted during this research

- **RFC 1951 — DEFLATE Compressed Data Format Specification version 1.3**, Deutsch, 1996.
  <https://www.rfc-editor.org/rfc/rfc1951.txt> — block types, 32 KiB window, match lengths 3–258,
  distances 1–32768, dynamic Huffman code-length transmission, the canonical-code rule.
- **RFC 7932 — Brotli Compressed Data Format**, Alakuijala & Szabadka, 2016.
  <https://www.rfc-editor.org/rfc/rfc7932.txt> — window `(1<<WBITS)−16` for WBITS 10–24, the
  **122,784-byte** static dictionary, **121** word transforms, the four context modes
  (LSB6/MSB6/UTF8/Signed), block switching.
- **Zstandard README benchmark table** (Silesia corpus, i7-9700K @ 4.9 GHz, Ubuntu 24.04, lzbench,
  gcc 14.2). <https://raw.githubusercontent.com/facebook/zstd/dev/README.md>
- **Duda, "Asymmetric numeral systems: entropy coding combining speed of Huffman coding with
  compression rate of arithmetic coding"**, arXiv:1311.2540.
  <https://arxiv.org/abs/1311.2540> — the ~50%-faster-than-Huffman decoding claim for a 256-symbol
  alphabet at arithmetic-coding rates.
- **Dubey et al. (Meta), "The Llama 3 Herd of Models"**, arXiv:2407.21783, §3.3.4.
  <https://arxiv.org/html/2407.21783v3> — 466 job interruptions in 54 days on 16,384 H100s; 419
  unexpected, ~78% confirmed hardware; faulty GPU 148 (30.1%), **GPU HBM3 memory 72 (17.2%)**, GPU
  SRAM 19 (4.5%), **silent data corruption 6 (1.4%)**; >90% effective training time; manual
  intervention three times.
- **Schroeder, Pinheiro & Weber, "DRAM Errors in the Wild: A Large-Scale Field Study"**,
  SIGMETRICS 2009.
  <https://research.google/pubs/dram-errors-in-the-wild-a-large-scale-field-study/> —
  25,000–70,000 errors per billion device-hours per Mbit; >8% of DIMMs affected per year; errors
  dominated by **hard** rather than soft errors; temperature has a surprisingly small field effect.
- **Dixit et al. (Meta), "Silent Data Corruptions at Scale"**, arXiv:2102.11245.
  <https://arxiv.org/abs/2102.11245> — tests across *"hundreds of thousands of machines"* yielding
  *"hundreds of CPUs detected for these errors"*; SDCs *"are not captured by error reporting
  mechanisms within a CPU and hence are not traceable at the hardware level"*; the conclusion that
  the fix needs *"robust fault-tolerant software architectures"*, not just hardware.
- **Cojocar et al. (VUSec), "Exploiting Correcting Codes: On the Effectiveness of ECC Memory
  Against Rowhammer Attacks"** (ECCploit), IEEE S&P 2019. <https://www.vusec.net/projects/eccploit/>
  — *"Only if you have three bitflips in the right places, will you be able to bypass ECC"*; the
  correction-timing side channel (*"measurably longer to read from a memory location where a bitflip
  needs to be corrected"*, up to 1000×), **CVE-2018-18904**; ~32 minutes to a week to find
  exploitable flips.
- **Linux kernel EDAC documentation.** <https://docs.kernel.org/driver-api/edac.html> —
  CE/UE/fatal/deferred definitions; the memory-controller → csrow → channel model.
- **BLAKE3 README.** <https://github.com/BLAKE3-team/BLAKE3> — *"Much faster than MD5, SHA-1,
  SHA-2, SHA-3, and BLAKE2"*; *"Highly parallelizable … because it's a Merkle tree on the inside"*;
  PRF/MAC/KDF/XOF; secure against length extension.
- **xxHash README.** <https://github.com/Cyan4973/xxHash> — XXH3 (SSE2) 31.5 GB/s, City64 22.0,
  XXH64 19.4, XXH32 9.7, SipHash 3.0 on an i7-9700K; all variants pass SMHasher.
- **Compiler Explorer APIs** — `https://godbolt.org/api/compiler/g152/compile` (execution),
  `https://godbolt.org/api/libraries/c++` (library catalogue; confirmed `zlib 1.3.1`,
  `openssl 1.1.1c/1.1.1g`, `boost`, `fmt` are available and, notably, that **no zstd, brotli, lz4 or
  xxhash library is offered** — hence zlib-only exercises).

## Primary literature referenced but not fetched (standard, stable, worth having on the reading list)

- **Shannon, "A Mathematical Theory of Communication"**, Bell System Technical Journal 27, 1948.
  The source coding theorem, the channel coding theorem, capacity, the separation theorem. Still the
  best-written paper in the field; assign §§1–7 directly.
- **Shannon, "Prediction and Entropy of Printed English"**, BSTJ 30(1), 1951. The English-entropy
  estimates and the gambling experiment. *(Flagged in §8.1 — figures recalled.)*
- **Huffman, "A Method for the Construction of Minimum-Redundancy Codes"**, Proc. IRE 40(9), 1952.
- **Hamming, "Error Detecting and Error Correcting Codes"**, BSTJ 29(2), 1950.
- **Reed & Solomon, "Polynomial Codes over Certain Finite Fields"**, J. SIAM 8(2), 1960.
- **Ziv & Lempel**, "A Universal Algorithm for Sequential Data Compression", IEEE IT-23, 1977
  (LZ77); "Compression of Individual Sequences via Variable-Rate Coding", IEEE IT-24, 1978 (LZ78).
- **Welch, "A Technique for High-Performance Data Compression"**, IEEE Computer, 1984 (LZW).
- **Witten, Neal & Cleary, "Arithmetic Coding for Data Compression"**, CACM 30(6), 1987. The
  reference implementation shape used in §7.4, including the underflow/straddle handling.
- **Burrows & Wheeler, "A Block-sorting Lossless Data Compression Algorithm"**, DEC SRC Research
  Report 124, 1994.
- **Ferragina & Manzini, "Opportunistic Data Structures with Applications"**, FOCS 2000 (the
  FM-index).
- **Gallager, "Low-Density Parity-Check Codes"**, MIT PhD thesis, 1962; **MacKay & Neal**, 1996
  (rediscovery); **Berrou, Glavieux & Thitimajshima**, ICC 1993 (turbo codes);
  **Arıkan**, IEEE IT-55, 2009 (polar codes).
- **Kim et al., "Flipping Bits in Memory Without Accessing Them: An Experimental Study of DRAM
  Disturbance Errors"**, ISCA 2014 (Rowhammer). Follow-ups: Google Project Zero (2015),
  Rowhammer.js (2015), Drammer (2016), Throwhammer/Nethammer (2018), GLitch (2018),
  TRRespass (2020), Half-Double (Google, 2021), Blacksmith (2021).
- **Meza, Wu, Kumar & Mutlu, "Revisiting Memory Errors in Large-Scale Production Data Centers"**,
  DSN 2015 (Facebook's fleet).
- **Hochschild et al. (Google), "Cores that don't count"**, HotOS 2021.
- **Koopman & Chakravarty, "Cyclic Redundancy Code (CRC) Polynomial Selection for Embedded
  Networks"**, DSN 2004, and the CRC Zoo at <https://users.ece.cmu.edu/~koopman/crc/>. The
  authority on CRC Hamming distance vs message length. *(§8.2 — thresholds recalled.)*
- **Sarwate, "Computation of Cyclic Redundancy Checks via Table Look-Up"**, CACM 31(8), 1988.
- **ITU-T T.81 / ISO/IEC 10918-1** (JPEG), 1992. Annex K carries the quantisation tables used in §7.6.
- **Merkle, "Protocols for Public Key Cryptosystems"**, IEEE S&P 1980 (Merkle trees).
- **Aumasson & Bernstein, "SipHash: a fast short-input PRF"**, INDOCRYPT 2012.
- **Stevens et al., "The first collision for full SHA-1"** (SHAttered), CRYPTO 2017.
- **Delétang et al. (DeepMind), "Language Modeling Is Compression"**, arXiv:2309.10668.
  *(§8.4 — figures recalled, not fetched.)*
- **Pelkonen et al. (Facebook), "Gorilla: A Fast, Scalable, In-Memory Time Series Database"**,
  VLDB 2015 — delta-of-delta timestamps and XOR float encoding (§2.12).
- **Huang et al. (Microsoft), "Erasure Coding in Windows Azure Storage"**, USENIX ATC 2012 —
  Local Reconstruction Codes and the repair-bandwidth problem (§4.5).
- **Li & Vitányi, "An Introduction to Kolmogorov Complexity and Its Applications"** — the standard
  reference for §1.7, including Chaitin's incompleteness theorem.
- **Cover & Thomas, "Elements of Information Theory"** — the standard textbook for §1. MacKay's
  *"Information Theory, Inference, and Learning Algorithms"* is the better one to hand a student,
  and is free online.

## Cross-references inside this curriculum's research set

- `fp4-fp8-blackwell.md` — §1–§3 for the FP4/MX/NVFP4 formats, block scaling, stochastic rounding
  and the random Hadamard transform. §3.5 here is the frame; that document is the detail.
- `networking-and-internet.md` — §1.1 for the Ethernet frame layout and the FCS field that §4.3
  explains; the layer-by-layer checksum stack that §4.2 argues about.
- `cpu-architectures.md`, `nvidia-architectures.md` — memory hierarchies and HBM, which §4.10 assumes.
