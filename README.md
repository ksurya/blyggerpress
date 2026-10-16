# BlyggerPress

A local-first studio for [Blygger](https://blygger.org) 0.3 blygs, and the
shared contracts the rest of the project is built against.

This repository pins the Blygger 0.3 specification and shared contracts, with
reader imports (SUK-140), the item lifecycle (SUK-137), and static publication
export (SUK-138), and composition/provenance (SUK-141) implemented.
The standalone studio (SUK-142) integrates these modules. Remaining deployment and release work is tracked by
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
npm ci                             # install runtime and test dependencies
npm test                           # lifecycle, reader, composition, and integration tests
npm run test:fixtures              # spec pin, all cases, and requirement coverage
node tools/build-requirements.mjs    # regenerate docs/REQUIREMENTS.md
node tools/build-wire-fixtures.mjs   # regenerate fixtures/wire/** and fixtures/store/**
```

Requires Node.js 20+ (uses `import.meta.dirname`). Composition uses `markdown-it`
and `parse5`; `npm ci` also installs the IndexedDB test dependency.

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
`downloadSiteBundle`; the standalone studio invokes this exporter.

`npm test` generates a lifecycle publication and runs all shared publication
fixture assertions on its actual files, checks privacy and preservation failures,
and independently verifies ZIP integrity/extraction and XML syntax when `unzip`
and `xmllint` are available (that test is skipped on systems without them).

## Subscription discovery and safe fetching (SUK-139)

The browser-compatible reader API now includes ordered URL discovery, bounded
fetching, manual refresh, and RSS/Atom file import. It plugs into the existing
private store and reconciliation engine; the standalone studio provides subscription, refresh, and file-import controls.

```js
import { createStore, createHttpPorts, subscribe, refreshSubscription,
  importFeedFile } from "./src/blyg/index.mjs";
const ports = createHttpPorts();
const result = await subscribe(createStore(), "https://example.com/blyg/", ports);
if (result.ok) {
  const refreshed = await refreshSubscription(result.store, result.subscription.id, ports);
  // Persist refreshed.store through the studio storage adapter.
}
// When browser CORS prevents access, use a user-selected file and its source URL:
const imported = await importFeedFile(createStore(), {
  feedUrl: "https://example.com/feed.xml", text: selectedFileText,
});
```

Discovery follows spec §12.1, including base-URL `rel="blyg"` links, a single
rel hop, and a shared six-request budget including redirects. Manifest identity
comes from the final manifest URL, with asserted-site disagreement returned as
subscription notices. File import creates legacy L0 entries, even when XML
contains blyg metadata; XML alone cannot establish canonical item authority.

The transport defaults to five redirects, 15 seconds for headers and body, and
1 MiB streamed bodies. Requests omit credentials and referrers. It rejects
unsafe schemes, credentials in URLs, local names and private IPv4 literals;
IPv6 literals are conservatively refused. Conditional requests reuse ETag and
Last-Modified. Manual refresh bypasses scheduling, performs index reconciliation,
and still records failures/backoff. Retry delays never shrink across failures.
Redirected feed/index/item responses cannot silently move an existing identity;
`resolveSubscriptionAgain` returns a proposal and requires the caller's explicit
`confirmIdentityChange: true` after user confirmation. Old imported origins remain
separate.

Browser CORS failures and opaque manual redirects are surfaced with file import
as a fallback. An optional Worker fetch proxy is a deployment convenience, not a
protocol requirement, and is not deployed or included here. A proxy can implement
the `fetchText` port, preserving the actual upstream `finalUrl` and enforcing
these bounds. Any server transport must additionally enforce public DNS results
and prevent rebinding at connection time; `validateDestination` is an integration
hook, not a DNS/egress implementation. Do not expose the default browser adapter
as an unrestricted server proxy. Browsers may override the identifying User-Agent.
Fetched HTML remains untrusted and must be sanitized by the rendering layer.

## Private persistence

SUK-136 supplies atomic IndexedDB persistence, v1→v2 migration, and private JSON
backup/restore. See [`src/studio/README.md`](src/studio/README.md) for the UI
integration API and failure behavior. Run `npm ci` then `npm test` for persistence
and reader tests; `npm run test:fixtures` runs the contract gate.

### Composition and provenance (SUK-141)

`blyg/compose` renders Markdown at publish time using only local published items
and imported reader snapshots. Full and partial `![[id]]` directives bake quoted
HTML; `[[id]]` produces an absolute ordinary link. Code is inert. Unknown,
ambiguous, withdrawn without retention, and L0 targets fail publication. Local
thread cycles fail; remote nested HTML is copied without walking its sources.
Direct references stay in directive order. Source edits and withdrawal never
rewrite a previously published bake or create pins.

```js
import { createLifecycle } from './src/blyg/index.mjs';
const writer = createLifecycle({
  origin: 'https://example.com/blyg/',
  getImported: () => readerStore.imported,
});
const draft = writer.newDraft({
  kind: 'thread', transclusions: [],
  contentMd: `A response.\n\n![[${importedItemId}]]`,
  stubOf: { origin: importedOrigin, id: importedItemId, version: seenVersion },
});
const event = writer.publishComposed(draft.localId);
// event.warnings reports unpinned remote quotations, when present.
```

`publish` automatically composes active directives/internal links and continues
composing that draft on later publishes, including removal of its last directive.
`publishComposed` also renders ordinary Markdown from scratch. The lifecycle's
existing prose-only, pre-rendered document API remains available to adapters.
Stubs may name a blyg reference or a plain-web `{url}`; only a directly quoted
blyg target updates the stub's version. Frozen `cited` labels stay outside HTML.

For generated prose, drafts accept private `generatedSpans` with UTF-16 `start`
and `end` offsets into `contentMd`, plus `sources`, `model`, and `at`. Ranges are
ordered and nonoverlapping and surround complete Markdown constructs. Inline
ranges use `blyg-tk-gen` spans; whole-body/block ranges use divs (`block: true`
explicitly requests one). Only the public generation metadata reaches item JSON;
No instructions or offset markers enter the Markdown or wire provenance.
Generation sources are own-origin references and never become transclusions.

`writer.newFork(pinnedDocument)` creates a draft with immutable, one-hop lineage.
It preserves the pinned source's own Markdown prose, flattens inherited quotes
recursively with visible attribution, and uses the pinned HTML's absolute links.
It copies withdrawn quoted content when that content is already in the pin.
Partiality comes from `blyg-partial` in the bake, supporting older clients whose
attached `>` lines were prose. Inherited quotation classes and verification
attributes disappear; generated disclosures survive with empty generation sources.
An optional `pageForQuote` callback can supply known quoted-item pages; otherwise
attribution links the item document. `checkForkPin` accepts a conditional-fetch
adapter for a separate online pin check: contrary 4xx/invalid-200 evidence fails,
while host failures return a warning. Composition itself performs no network I/O.

`referenceStatus` compares direct references against a document fetched at an
explicit identity origin. It never treats `cited`, an author object, or deeper
quotation freshness as verification. Imported composition metadata and opaque
citations survive reconciliation and pin retention.

The executable tests in `test/composition.test.mjs` cover every SUK-141 requirement;
`fixtures/composition/snapshots.json` adds a cross-client nested/withdrawn example.


## Standalone studio (SUK-142)

Run `npm ci && npm run build`, then open `dist/index.html` in a browser.
The artifact bundles all JavaScript, Markdown rendering, and styles in one file;
it needs no CDN or development server. Keep using the same file location or
hosted origin to access the same browser library. Browser storage availability
and file-origin behavior depend on the browser; a storage failure blocks editing
and reports the error without resetting existing data.

Set a publication URL and title in **Library & publication**, then use **Write**
for fragments and threads. Draft saves remain private. Preview uses the shared
publication renderer; local publish creates a version, while the public ZIP is
what you deploy. Published items support editing/return, pins, withdrawal,
preview, and forks of pinned versions. Threads support quotation directives,
partial quotations, and ordinary internal links. The optional composition JSON
editor exposes stub references and generated-span disclosure metadata through
the shared composition API. Invalid metadata or unresolved references fail
without advancing the durable publication.

**Read** supports private subscriptions, manual refresh, RSS/Atom file import,
subscription/date filters, likes/dislikes, and per-post notes. Imported content
runs in a sandboxed iframe with scripts and network resources blocked. Only
subscriptions explicitly selected for the curated public blogroll become OPML
entries in the public export. Drafts, notes, feedback, and other reader state
are never passed to the public exporter.

Private backup download and inspected, confirmed replacement restore live in
**Library & publication**. Restore downloads the current backup before replacing
the library. Save conflicts and storage errors retain editor input; reload a
conflicting tab after preserving unsaved text. There is no automatic reset.

Validation: `npm test`, `npm run test:fixtures`, and `npm run test:studio`.
The browser check uses Playwright Chromium (`npx playwright install chromium`),
or `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an installed Chrome binary. It
checks the generated standalone file, publication preview, save/publish/reload,
ZIP download, reader file import, note/feedback persistence, and a 390px layout.
Screenshots are saved under `.context/`. Phone hardware and WebKit validation,
media-upload UI, hosting/deployment, and full release conformance remain outside
this implementation.
