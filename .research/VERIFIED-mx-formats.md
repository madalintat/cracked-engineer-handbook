# Verification note: OCP MX concrete formats

The fp4-fp8-blackwell research flagged that the OCP MX v1.0 spec PDF could not be
retrieved (opencompute.org is Cloudflare-gated; the saved "ocp_mx.pdf" is a block page).
Every MX number in that report was therefore derived/corroborated, not quoted.

**Gap now closed against a primary source.** arXiv 2310.10537v3, "Microscaling Data
Formats for Deep Learning" — authored by the OCP MX working group (Microsoft, AMD,
Intel, NVIDIA, Meta), the same body that wrote the spec. Section 2.2, Table 1:

    Format    Block  Scale   Scale   Element              Element
    Name      Size   Format  Bits    Data Format          Bit-width
    MXFP8      32    E8M0      8     FP8 (E4M3 / E5M2)       8
    MXFP6      32    E8M0      8     FP6 (E2M3 / E3M2)       6
    MXFP4      32    E8M0      8     FP4 (E2M1)              4
    MXINT8     32    E8M0      8     INT8                    8

Confirms: block size 32 for all four concrete formats; E8M0 shared scale for all four;
the element-format pairings. Matches the research report exactly.

## Additional facts from the paper not in the report (both teachable)

- **Block layout is NOT prescribed.** Sec 2: "an implementation may store X contiguously
  with or separately from the elements." So an MX block is a logical grouping; the
  physical layout is a hardware/kernel decision. Relevant to CuTe layout work.
- **The shared scale encodes NaN but never Inf.** Sec 2.1: if X = NaN then all k values
  are NaN regardless of the element encodings; "The shared scale X does not encode Inf."
  Inf is reachable only per-element, and only for element formats that have it (E5M2 yes;
  E4M3, E2M1, FP6 no).
- **Value semantics:** v_i = X * P_i, and if |X*P_i| > FLT_MAX the result is
  implementation-defined -- not an overflow to Inf.

## Still open (unchanged)

The spec's Section 6.3 conversion algorithm is only described second-hand; the paper's
Algorithm 1 "follows the semantics" of it but the spec explicitly permits other
conversion recipes. If a unit teaches quantization, say that the recipe is
implementation-defined rather than presenting one as canonical.

Source PDF saved alongside this note as source-mx-paper-2310.10537.pdf
