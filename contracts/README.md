# Contracts

The shared, testable reading of the pinned Blygger 0.3 spec. Two kinds of file:

- `schemas/*.schema.json` — JSON Schemas (draft 2020-12) for every wire shape
  and for the private local store.
- `requirements.json` — the authoritative requirement → module → issue → fixture
  registry that drives [`../docs/REQUIREMENTS.md`](../docs/REQUIREMENTS.md).
- `exclusions.json` — the §16 non-normative constructs this MVP excludes, with
  the room each one must be left.

## The reader-acceptance stance

Blygger's ignore-unknown rule (§3, §13.1) is normative: a reader **MUST** ignore
constructs it does not understand rather than reject the document that contains
them. A schema that used `additionalProperties: false` would encode the opposite
of the protocol.

So these schemas are **reader-acceptance schemas**: they describe the *known*
structure of each construct and set `additionalProperties: true` everywhere, so
that validating a document proves what a conforming reader must understand, not
what a publisher is forbidden from adding. Unknown kinds are typed as
`type: "string"` (not `enum`), unknown members are permitted, and reserved
constructs validate and are then ignored.

Emit-strictness for *our own* publisher is captured separately, per schema, as an
`x-emit-required` annotation — the field set the studio must emit — and is
enforced by the publication fixtures (`fixtures/cases/80-publication.json`), not
by rejecting unknown members. The `wire.item.accept-unknown-kind` and
`wire.item.accept-unknown-members` cases are the executable proof of the stance.

## Schema inventory

All publishable shapes are wire shapes. Only `local-store` is private.

| Schema (`$id`) | File | Describes | Publishable | `x-emit-required` |
|---|---|---|---|---|
| `blygpress:common` | `common.schema.json` | Shared `$defs`: `Id`, `BlygKey`, `Iso8601Utc`, `ContentHash`, `Level`, `Kind`, `Relation`, `Author`, `MediaEntry`, `ChangelogEntry`, `Selector`, `Cited`, `Reference`, `AbsoluteReference`, `Transclusion`, `StubOf`, `GeneratedSpan`, `ItemSummary` | — (shared) | — |
| `blygpress:item` | `item.schema.json` | Canonical item document `items/{id}.json` (§5) | yes | `blyg,id,kind,origin,page,created,updated,version,content_md,content_html,content_hash,changelog` |
| `blygpress:manifest` | `manifest.schema.json` | Manifest `blyg.json` (§6.1) | yes | `blyg,site,title,feed,items,updated` |
| `blygpress:archive-index` | `archive-index.schema.json` | Archive index `items/index.json` (§6.2) | yes | `updated,items` |
| `blygpress:pinned-version` | `pinned-version.schema.json` | Pinned version `items/{id}/v{n}.json` (§8) | yes | see schema |
| `blygpress:feed-model` | `feed-model.schema.json` | Reader-side normalized feed (§7, §13.2) | derived | — |
| `blygpress:blogroll` | `blogroll.schema.json` | Reader-side normalized OPML blogroll (§11) | derived | — |
| `blygpress:webmention` | `webmention.schema.json` | Webmention `Request`, `OutboundRecord`, `VerificationResult` (§15) | records are private-to-the-receiver | — |
| `blygpress:local-store` | `local-store.schema.json` | The private studio store | **no** (`x-publication: false`) | — |

`feed-model` and `blogroll` describe what a *reader* derives from `feed.xml` and
`blogroll.opml`; they are not emitted to the wire. `webmention` records are
receiver/local state, never published. `common` is referenced by the others and
is never validated directly.

## Annotations

These are non-standard keywords the tooling understands; standard validators
ignore them.

- **`x-emit-required`** — the fields our publisher must emit for that shape.
  Checked by the `emitStrict` expectation on schema cases and by the publication
  fixtures. This is where "strict on emit" lives without breaking "lenient on
  read".
- **`x-publication`** — `false` marks a shape that must never appear in any
  publication artifact. Only `local-store` sets it. See the fail-closed boundary
  in [`../docs/CONTRACT.md`](../docs/CONTRACT.md).
- **`x-conformance`** — provenance: the spec sections, the owning issue, and the
  notes that explain the non-obvious choices.
- **`$comment`** — used inside compositional branches (`allOf`/`if`/`then`) to
  explain the conditional in place.

## `requirements.json`

An array of requirement records. Each has:

| Field | Meaning |
|---|---|
| `id` | Stable ID, e.g. `R5.1-1` (prefix `R`, section, ordinal). Cited by fixtures. |
| `section` | The § of the pinned spec. |
| `keyword` | The RFC 2119 modal (`MUST`, `MUST NOT`, `SHOULD`, `MAY`, `INFO`, …). |
| `module` | The namespace that owns the behaviour (see `docs/CONTRACT.md`). |
| `issue` | The implementation issue that delivers it (`SUK-1xx`). |
| `fixtures` | The conformance cases that pin it. |
| `statement` | A one-line reading of the requirement. |
| `optional` / `recommended` / `informative` | Flags for the MVP-optional and non-binding entries. |

`tools/build-requirements.mjs` renders `docs/REQUIREMENTS.md` from this file and
`exclusions.json`. `tools/validate-fixtures.mjs` fails if the rendered doc is
stale, or if a requirement cites a fixture no case defines.

## Working with the contracts

```sh
node tools/validate-fixtures.mjs     # the gate: spec pin + all cases + coverage
node tools/build-requirements.mjs    # regenerate docs/REQUIREMENTS.md
node tools/build-wire-fixtures.mjs   # regenerate fixtures/wire/** and fixtures/store/**
```

To add or adjust a contract: change the schema and/or `requirements.json`, add
the fixture that pins it, run the generator, and run the gate. Do not edit
`docs/REQUIREMENTS.md` or anything under `fixtures/wire/**` or
`fixtures/store/**` by hand — both are generated.
