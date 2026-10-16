# BlyggerPress

A local-first studio for [Blygger](https://blygger.org) 0.3 blygs, and the
shared contracts the rest of the project is built against.

This repository is currently at the **contract stage**: it pins the Blygger 0.3
specification, defines the shared module interfaces, and ships the conformance
fixtures that every implementation issue tests against. Product modules are
delivered by the sibling issues (SUK-136..SUK-146).

## What this repo contains

- **A pinned spec.** `docs/spec/blygger-0.3.md` is a byte-exact copy of the
  uploaded 0.3 draft, hash-checked by the gate. See `docs/spec/PROVENANCE.md`.
- **Shared contracts.** Reader-acceptance JSON Schemas for every wire shape and
  the private store, in `contracts/schemas/`. The requirement registry is
  `contracts/requirements.json`; the §16 exclusions are
  `contracts/exclusions.json`.
- **Conformance fixtures.** A canonical sample blyg (plus a second origin), a
  private reader store, normalized reader models, and 141 conformance cases in
  `fixtures/`.
- **A zero-dependency gate.** `tools/validate-fixtures.mjs` checks the spec pin,
  every case, and requirement↔fixture coverage — no install required.

## Quick start

```sh
node tools/validate-fixtures.mjs     # the gate (exit 1 on failure)
node tools/build-requirements.mjs    # regenerate docs/REQUIREMENTS.md
node tools/build-wire-fixtures.mjs   # regenerate fixtures/wire/** and fixtures/store/**
```

Requires Node.js 20+ (uses `import.meta.dirname`). No dependencies.

## Documentation

- **Architecture and module interfaces** — [`docs/CONTRACT.md`](docs/CONTRACT.md)
- **Requirement → module → issue → fixture matrix** — [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md)
- **How to read the schemas** — [`contracts/README.md`](contracts/README.md)
- **The conformance cases** — [`fixtures/README.md`](fixtures/README.md)
- **The pinned spec** — [`docs/spec/blygger-0.3.md`](docs/spec/blygger-0.3.md)

## Target

The studio is a responsive, local-first app shipped as a single standalone HTML
file on GitHub Pages (vanilla HTML, rudimentary styling); a published blyg is a
multi-file static site. The required views are canonical JSON and
human-readable HTML. Private notes, drafts, interests, and credentials never
leave the local store. Conformance target: **Level 2 with Level 1 carried
forward**; §16 constructs are out of scope.

## Status

Contract layer: **complete and gated**. Implementation: SUK-136..SUK-145,
validated for full coverage and interoperability by SUK-146.
