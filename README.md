# BlyggerPress

A local-first studio for [Blygger](https://blygger.org) 0.3 blygs, and the
shared contracts the rest of the project is built against.

This repository pins the Blygger 0.3 specification and shared contracts, with
reader imports (SUK-140), the item lifecycle (SUK-137), and static publication
export (SUK-138) implemented.
The remaining studio, composition, deployment, and release work is tracked by
SUK-136..SUK-146.

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
npm test                           # lifecycle, reader, and integration tests
npm run test:fixtures              # spec pin, all cases, and requirement coverage
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

Contract layer: **complete and gated**. Item lifecycle and reader imports are
implemented; full MVP coverage and interoperability remain the SUK-146 release
gate. This module does not establish full-protocol conformance.

## Item publication lifecycle

`src/blyg/index.mjs` exports the dependency-free lifecycle and reader APIs. The
lifecycle runs in browsers and Node; clocks and ID factories can be injected for
deterministic tests. Production IDs use Web Crypto randomness.

```js
import { createLifecycle, projectItemFiles, serializeFiles } from "./src/blyg/index.mjs";

const lifecycle = createLifecycle({ origin: "https://example.com/blyg/" });
const draft = lifecycle.newDraft({ contentMd: "Hello", contentHtml: "<p>Hello</p>" });
lifecycle.saveDraft(draft.localId, { contentMd: "Hello again", contentHtml: "<p>Hello again</p>" });
const published = lifecycle.publish(draft.localId); // v1; draft saves emit nothing
lifecycle.pin(published.itemId, published.version);
lifecycle.withdraw(published.itemId); // v2 endcap; pinned v1 remains available
const files = serializeFiles(projectItemFiles(lifecycle.listItems()));
// files contains only canonical item JSON and explicitly pinned versions.
```

For edits and returns, open a draft with `itemId`, the original authored `kind`,
and the new content. A thread draft requires `transclusions`, even when empty.
Identity, author, lineage, and page are preserved. Failed publishes leave item
and draft state unchanged. Published documents are detached copies; unpinned
history cannot be obtained through `pinnedDocument`.

Before publishing media, call `registerMedia(entry, { bytes })`, or supply a
precomputed lowercase SHA-256 `digest`. Each media URL locks its MIME and byte
digest; changing bytes requires a new URL. `retainedMediaUrls()` lists assets
promised by pins, including after withdrawal. Asset storage/export adapters must
persist those bytes and the private ledger and honor retention; this in-memory
engine does not write files or implement durable storage.

`listItems`, `snapshot`, `versions`, and draft APIs return **private authoring
state**, including withheld history. Never serialize them into a publication.
Use `projectItemFiles` for wire output. It shares publication assertions and
fixtures with the static export work (SUK-138); the complete export adapter is described below. Render and sanitize HTML
before handing it to this engine.

Changelog notes are explicit publication metadata. The engine rejects complete
withheld bodies and normalized quotes of 40 or more characters; this is a
conservative guard, not a semantic proof. Authors must also avoid shorter quotes
or paraphrases that reproduce withheld content. Generation provenance is
allow-listed and self-asserted; authoring instructions never become wire fields.


## Complete static publication export

```js
import { buildStaticPublication, downloadSiteBundle } from "./src/blyg/index.mjs";

const options = {
  origin: "https://example.com/any/base/path/", // HTTP(S), trailing slash
  title: "My blyg",
  author: { name: "Writer" }, // publication imprint; separate from item bylines
  items: lifecycle.listItems(),
  assets: [], // { url, mime, bytes: Uint8Array, digest: registered SHA-256 hex }
  previousFiles: [], // last successful buildStaticPublication result
};
const files = buildStaticPublication(options); // [{ path, body: string | Uint8Array }]
// Save these files through a deployment adapter, or download from the browser:
downloadSiteBundle(options); // blyg-site.zip; unpack into the configured mount
```

The bundle includes `blyg.json`, `items/index.json`, canonical item JSON,
explicitly pinned version JSON, `feed.xml`, immutable media bytes, a homepage,
complete readable archive, item permalinks, and pinned version pages. Each page
has manifest, RSS, canonical, and JSON discovery links, with inline rudimentary
styling and no JavaScript or external stylesheet dependency. Protocol content
is never rewritten with page chrome. No conformance `level` is claimed.

RSS defaults to the newest 50 **publish events** (`window` overrides this), each
with latest content and its event's version/note/date. Withdrawn items contribute
only their endcap event; their canonical page and any earlier pins remain.
The archive has no window. Empty publications require an explicit UTC `updated`;
otherwise it defaults to the latest publish event. Pass a later `updated` when
publication metadata changes independently of content.

Only current and pinned media references are selected from `assets`; unused
asset inputs are ignored. All selected media must be under the publication's
`media/` path and include bytes matching the digest registered before publish.
External media must first be ingested by the authoring adapter. Supplied
`content_html` must already be sanitized, fully baked, and use absolute URLs,
including transclusions; Markdown/composition rendering belongs to SUK-141.
The exporter preserves these protocol bytes, including pinned content.

Persist the media digest ledger and the last successful `files` result locally.
Passing `previousFiles` prevents an export from losing a published canonical
item or changing/removing pins, pinned pages, or media; old media bytes remain
available. Without that baseline, the exporter can validate only the supplied
snapshot and media evidence. Private drafts, reader state, credentials and
unpinned historical bodies are never serialized. Do not pass private text in
public imprint fields, item bylines, or changelog notes.

Deploy the complete file set to a static host at the configured origin. Remove
stale files from earlier deployments so unpinned history and unknown IDs return
404; disable SPA fallbacks. The `.nojekyll` marker supports GitHub Pages, and
`_headers` requests permissive CORS on hosts that support it. Other hosts must
configure JSON/XML CORS themselves. There is no Webmention endpoint or blogroll
advertised by this export. The studio's future export button can invoke
`downloadSiteBundle`; this repository does not yet contain a studio UI.

`npm test` generates a lifecycle publication and runs all shared publication
fixture assertions on its actual files, checks privacy and preservation failures,
and independently verifies ZIP integrity/extraction and XML syntax when `unzip`
and `xmllint` are available (that test is skipped on systems without them).
