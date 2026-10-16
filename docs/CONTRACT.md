# Shared data contracts

This repository is the **contract layer** for BlyggerPress-2. It pins the
uploaded Blygger 0.3 specification, defines the shared module interfaces the
implementation issues build against, and provides the conformance fixtures that
keep those implementations honest. It deliberately contains **no product
modules** — those are delivered by the sibling issues (SUK-136..SUK-146), each
of which owns its own tests against the fixtures defined here.

Read this document together with:

- [`../docs/spec/blygger-0.3.md`](spec/blygger-0.3.md) — the pinned spec (authoritative for behaviour).
- [`REQUIREMENTS.md`](REQUIREMENTS.md) — generated requirement → module → issue → fixture matrix.
- [`../contracts/README.md`](../contracts/README.md) — the JSON Schemas and their reader-acceptance stance.
- [`../fixtures/README.md`](../fixtures/README.md) — the conformance cases and how they are checked.

The rule that governs everything below: **the protocol text is the specification;
these schemas and fixtures are a pinned, testable reading of it.** Where the two
ever disagree, the pinned spec wins and the contract is fixed, not the spec.

## Product shape

- The **studio** is a responsive, local-first authoring + reading app, shipped as
  a single standalone HTML file on GitHub Pages, using vanilla HTML and
  rudimentary styling. Protocol content is kept separate from page presentation.
  There are no theme packages, custom templates, or theme controls.
- A **published blyg** is a multi-file static site: `blyg.json`, `feed.xml`,
  `items/index.json`, `items/{id}.json`, pinned `items/{id}/v{n}.json`, media,
  an optional `blogroll.opml`, and optional HTML pages.
- The required views are **canonical JSON** and **human-readable HTML**. A
  separate LLM/plain-text view is *not* required.
- Private state (drafts, notes, interests, ranking, subscriptions, imported
  items, credentials) lives only in the local store and never reaches the wire.

## Repository map

```
contracts/
  README.md              how to read the schemas
  requirements.json      authoritative requirement → module → issue → fixture registry
  exclusions.json        §16 non-normative constructs excluded from this MVP
  schemas/*.schema.json  reader-acceptance JSON Schemas for every wire + store shape
docs/
  CONTRACT.md            this document
  REQUIREMENTS.md        generated traceability matrix
  spec/blygger-0.3.md    the pinned spec (hash-checked)
  spec/PROVENANCE.md     where the pin came from and why
fixtures/
  README.md              the conformance cases
  wire/                  canonical + remote sample blyg trees
  store/                 the private reader store
  models/                expected normalized reader models
  cases/                 the conformance cases, by concern
tools/
  validate-fixtures.mjs  the conformance gate (zero dependencies)
  build-wire-fixtures.mjs regenerates fixtures/wire/** and fixtures/store/**
  build-requirements.mjs  regenerates docs/REQUIREMENTS.md
  lib/oracle.mjs          reference primitives used to generate/check fixtures
  lib/schema-validate.mjs a minimal JSON Schema 2020-12 subset validator
```

## Module interfaces

The namespaces below are the shared surface. A module owns the behaviour of its
constructs; nothing outside a module reads its private state. The `Issue` column
names the implementation issue that delivers the module. Operations are named in
the language the fixtures use; implementation languages may vary, but the
**observable contracts** (inputs, outputs, and the errors that gate publishing)
must match.

### Wire primitives (publish and read)

| Module | Issue | Owns | Key operations (observable contracts) |
|---|---|---|---|
| `blyg/ids` | SUK-137 | §5.1 identity | `newId()` → 26-char lowercase Crockford base32 from 128 random bits; `isValidId(id)`; encode/decode. IDs never change across versions, withdrawal, or return. |
| `blyg/hash` | SUK-137 | §5.1 `content_hash` | `contentHash(content_md)` → `"sha256:" + hex(SHA-256(utf8))`. Covers `content_md` only. |
| `blyg/item` | SUK-137 | §5 item document | Construct/validate the item document; enforce `updated == latest changelog at`, titleless items, kind conditionals. |
| `blyg/media` | SUK-137 | §5.4 media | Media entries (`url`, `mime`, optional `alt`); immutability of published URLs. |
| `blyg/reference` | SUK-141 | §5.9 references | `{origin?, id, version}`; `referencesEqual` (identity members only, ignore `cited`); `isStale(reference, targetDoc)` direct, non-transitive. |
| `blyg/manifest` | SUK-138 | §6.1 manifest | Parse/emit `blyg.json`; required keys; optional `blogroll`/`webmention` only when served. |
| `blyg/index` | SUK-138 | §6.2 archive index | Full, unwindowed index ordered by `updated` desc, including withdrawn items. |
| `blyg/feed` | SUK-138 | §7 RSS feed | Parse/emit RSS 2.0 + `blyg:` namespace; one `<item>` per publish event; derived `<title>`; withdrawal collapses to one entry; pinning emits none. |
| `blyg/pins` | SUK-138 | §8 pinned versions | Emit/fetch `items/{id}/v{n}.json`; pinned files are immutable and 200 forever; withdrawal endcaps are never pinned; pinned docs carry no `media`. |
| `blyg/markdown` | SUK-141 | §2, §10.2 text | Markdown → self-contained HTML with absolute URLs; `textContent(html)` for the partial-quotation check. |
| `blyg/compose` | SUK-141 | §10 composition | Directive grammar, resolution order, baking (transclusion/partial/stub/fork), the publish-time error set. |
| `blyg/opml` | SUK-138 | §11 blogroll | Standard OPML 2.0, no extensions; normalize to the blogroll model. |
| `blyg/export` | SUK-138 | §4 surface | Emit the static surface; enforce the 200/404 permanence rules; the fail-closed publication boundary. |
| `blyg/resolve` | SUK-139 | §12.1–12.2 discovery | The six-step resolution procedure; identity = final fetch origin. |
| `blyg/fetch` | SUK-139 | §12.3, §14 fetching | Conditional requests, backoff, bounded redirects, fetch hygiene. |
| `blyg/reconcile` | SUK-140 | §13 reconciliation | Roll-up by origin+id, watermarks/discrepancies, withdrawal handling, L0 wrapping. |
| `blyg/webmention` | SUK-144 | §15.2 outbound | Relation set, discovery order, retry policy, re-send rules. |
| `blyg/store` | SUK-136 | §11, §13 local state | Subscriptions and imported rows; "no protocol follow" — all client-local. |

### Studio (authoring/reading app)

| Module | Issue | Owns | Notes |
|---|---|---|---|
| `studio/store` | SUK-136 | The private local store | Drafts, notes, feedback, ranking, subscriptions, imported items, mentions, publish targets, credential *metadata*. Schema: `local-store.schema.json`. Entirely private. |
| `studio/rank` | SUK-145 | Ordering policy | Reader-side display ordering and profile inputs; never published. |
| `studio/ui` | SUK-142 | Studio shell | Single-file, local-first, vanilla; renders sanitized content; keeps presentation separate from protocol content. |
| `studio/publish-github` | SUK-143 | GitHub publishing | Writes the static surface to a repo; consumes the export module. Never protocol. |

### Worker

| Module | Issue | Owns | Notes |
|---|---|---|---|
| `worker/webmention` | SUK-144 | §15.3–15.4 receiver | Accept (202/400/429), bounded verification, relation resolution, pointer-only storage. |

## Dependency graph

```
                  blyg/ids ── blyg/hash
                     │           │
                     └────┬──────┘
                          ▼
                      blyg/item ────── blyg/media
                          │  \
             blyg/reference ────── blyg/compose ── blyg/markdown
                     │                 │
        blyg/manifest  blyg/index  blyg/feed  blyg/pins  blyg/opml
                     \        |         |        |       /
                      \       ▼         ▼        ▼      /
                       ────────► blyg/export ◄────────
                                   ▲    ▲
                                   │    │
                          blyg/resolve  blyg/fetch ── (§14 hygiene)
                                   │
                                   ▼
                            blyg/reconcile ── blyg/store
                                   ▲
                                   │
                        blyg/webmention ── worker/webmention
                                   ▲
                                   │
                       studio/* ─── studio/publish-github
```

Reading the graph as a build order: **identity and hashing first**, then the
document shapes, then the publication surfaces, then discovery/fetching, then
reconciliation and the studio. `blyg/export` is the narrow waist: it is the only
module allowed to produce publication artifacts, and everything publishable flows
through it.

## The publication boundary (fail-closed)

The single most important shared rule. **Only wire constructs are publishable.**

- **Publishable shapes** are the ones with `x-publication !== false`: manifest,
  item, pinned version, archive index, feed model, blogroll, webmention records.
- **Private shapes** carry `x-publication: false` (for example
  `local-store.schema.json`). Nothing in a private shape may appear in any
  publication artifact — not in `blyg.json`, an item document, the feed, the
  index, the blogroll, a pinned file, or a rendered page.
- The export path is **fail-closed**: an artifact is built from an explicit
  allow-list of wire fields, never by serializing an internal object and hoping
  the private fields are not reachable. Adding a private field to the store can
  therefore never leak by default.
- Private tokens are asserted absent from the publication in
  `fixtures/cases/70-privacy.json`, and the store keeps the same tokens so the
  test proves they are only kept, never published.

The `local-store.schema.json` description enumerates what must never leak:
drafts, notes, interests/ranking intent, feedback, subscription records,
imported items and their watermarks, credential material and metadata, and
generation instructions (`authoringState`).

## Invariants the fixtures enforce

These are the load-bearing rules implementations must not violate; each is
traceable to requirement IDs in [`REQUIREMENTS.md`](REQUIREMENTS.md).

1. **Identity is permanent.** An `id` never changes across versions, withdrawal,
   or return (§5.1). Ids are scoped to the origin they were learned from (§13.1).
2. **Only the latest content is served.** Older versions 404 unless pinned; the
   changelog is metadata, never content or a diff (§5.2, §8).
3. **Pins are irrevocable.** A pinned file returns 200 forever, including after
   withdrawal; withdrawal endcaps are never pinned; pinned documents carry no
   `media` (§8).
4. **Withdrawal rolls up to null.** A reader stops presenting withdrawn content
   and deletes its copy, except content retained under a pin, with attribution
   (§13.4). The item document stays 200 forever (§9).
5. **The feed is a lossy signal.** Only a fetched document advances state; the
   feed never mutates state and pinning emits no feed event (§7, §13.2).
6. **Composition is baked, never live.** A thread's snapshot is what its author
   saw; later source changes do not alter it, and there is no auto-pin (§10.4).
7. **Unknown constructs are ignored, never fatal.** Unknown kinds, JSON members,
   `blyg:*` elements, and reserved constructs are dropped without rejecting the
   container (§3, §13.1).
8. **Origin scoping is absolute.** Ids, authors, and trust do not transfer across
   origins (§5.5, §13.1).
9. **Imported content is never re-emitted.** Imported items never appear in the
   publisher's feed, index, or item documents (§13.5).
10. **Store verbatim, sanitize at render.** Fetched `content_html` is stored
    as-is and sanitized/sandboxed only when rendered (§14).

## How the conformance cases are checked

`node tools/validate-fixtures.mjs` is the gate. It runs five kinds of case, all
defined in [`fixtures/cases/`](../fixtures/README.md):

- **schema** — a JSON instance validates (or fails to validate) against a wire schema.
- **vector** — a pure primitive matches the reference oracle (IDs, hashes, RFC 822, text content, reference equality, staleness, RFC 6570 expansion).
- **publication** — cross-file invariants of a whole publication tree hold.
- **privacy** — forbidden private tokens are absent from the publication and present in the store.
- **spec** — a documented behavioural scenario is well-formed and linked to real requirement IDs, modules, and issues.

The gate also fails if the pinned spec's SHA-256 drifts, if `docs/REQUIREMENTS.md`
is stale, or if any requirement cites a fixture that no case defines.

## Conformance target

L2 with L1 carried forward. All normative and MVP-optional requirements of §§2–15
are in scope; §16 constructs are excluded (see
[`contracts/exclusions.json`](../contracts/exclusions.json)). Each implementation
issue owns the tests for its module; the final release-validation issue (SUK-146)
checks full coverage and cross-module interoperability against these fixtures.
