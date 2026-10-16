# Pinned specification provenance

This directory holds the **implementation baseline** for BlyggerPress-2: the
Blygger Protocol, version 0.3, at conformance Level 2.

| Field | Value |
|---|---|
| Document | The Blygger Protocol — Version 0.3 |
| Version | `0.3` (DRAFT; every sub-1.0 version is a working draft) |
| Conformance target | L2 with L1 carried forward (publish side, subscribe side, cross-client constructs) |
| Source | Uploaded to Linear issue **SUK-135** ("Define shared data contracts and conformance fixtures") as an attachment |
| Retrieved | 2026-10-16 |
| File | `docs/spec/blygger-0.3.md` (verbatim copy) |
| SHA-256 | `f39eb644a9741f2e68250954e784750c9b22dd6ac2b7d7bd6c0d6eff63448a4b` |
| Lines | 2313 |
| License | CC-BY-4.0 (per the document itself) |

## Why pinned

The living text at `https://blygger.org/spec/0.3/` moves: pre-1.0 the spec is a
draft and changes in response to testing. The project rule (stated in the
document) is to **cite and pin to a snapshot** when the text must not move.
This copy is that pin for the MVP: all contracts, fixtures, and acceptance
tests in this repository are written against the bytes above, identified by the
SHA-256 in the table.

If the upstream text is later revised, do **not** edit this file in place.
Add a new dated copy and a new row recording the diff, and re-run the fixture
suite against the new text before changing any contract.

## Integrity check

```sh
shasum -a 256 docs/spec/blygger-0.3.md
# expected: f39eb644a9741f2e68250954e784750c9b22dd6ac2b7d7bd6c0d6eff63448a4b
```

The `tools/validate-fixtures.mjs` gate verifies this hash and fails if the
pinned spec drifts.

## Scope of this repository against the pinned text

- **Implement:** all normative (MUST / MUST NOT / SHOULD / SHOULD NOT /
  RECOMMENDED) requirements of §§2–15, plus every optional feature that the MVP
  makes available to users (blogroll, Webmention, `page`, lineage, stubs, partial
  quotation, `cited`, `generator_url`, generated provenance, L0 grandfathering).
- **Exclude:** the explicitly non-normative future constructs of §16. See
  [`../REQUIREMENTS.md`](../REQUIREMENTS.md) for the full exclusion list and
  the requirement → module → fixture traceability matrix.
