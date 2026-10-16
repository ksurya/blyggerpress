# Requirements and traceability

> **Generated file.** Do not edit by hand. Run `node tools/build-requirements.mjs`.
> The authoritative registry is [`contracts/requirements.json`](../contracts/requirements.json);
> the exclusion list is [`contracts/exclusions.json`](../contracts/exclusions.json).
> `tools/validate-fixtures.mjs` fails if this file is stale or if any requirement's
> fixtures are not defined by a conformance case.

## What this is

Every normative and MVP-optional requirement of the pinned Blygger 0.3 spec
(§§2–15), mapped to the module that owns it, the implementation issue that
delivers it, and the conformance fixtures that pin it. Sections 16 and 17 are
non-normative; §16 is summarised under [Excluded constructs](#excluded-constructs).

## Summary

- Requirements: **173** (16 optional/MAY/RECOMMENDED, 1 informative).
- Modules: **21**.
- Implementation issues: **9**.
- Conformance fixtures referenced: **124** (see [`fixtures/`](../fixtures/README.md)).

| Issue | Requirements |
|---|---:|
| SUK-136 | 2 |
| SUK-137 | 18 |
| SUK-138 | 49 |
| SUK-139 | 10 |
| SUK-140 | 33 |
| SUK-141 | 32 |
| SUK-142 | 1 |
| SUK-144 | 27 |
| SUK-145 | 1 |

## Excluded constructs

The constructs below are non-normative in the pinned text (§16) and are **out of
scope** for this MVP. Each row records the room, if any, the MVP must leave.

| ID | § | Construct | Status | Room left |
|---|---|---|---|---|
| EX-16.3 | 16.3 | Remote generation sources | 0.4 construct — fourth mention relation `source` | `generated[].sources[]` already uses the §5.9 reference shape with an optional origin, and readers ignore unknown members, so a 0.4 remote source needs no wire change. The MVP never emits or sends a `source` relation. |
| EX-16.4 | 16.4 | Titles (closed) | closed — no title field at any version | None. The RECOMMENDED `<title>` derivation already begins with the heading when there is one; no field is reserved. |
| EX-16.5 | 16.5 | Transitive staleness | resolved — there is no such thing, and none will be defined | None on the wire; nested `data-blyg-*` attributes plus the direct §5.9 check are sufficient for a presentation aid. |
| EX-16.6 | 16.6 | The write surface | never normative; a non-normative companion note is planned | None on the manifest: tools discover a write endpoint through an HTML `rel` link on the studio page, never through the manifest. The manifest stays clean. |
| EX-16.6b | 16.6b | Identity, groups, and agents | ruled — no construct; technical notes only | `author` is an opaque object readers must accept and carry verbatim; no addressable author exists. |
| EX-16.6d | 16.6d | Forward discovery / per-item responses surface | kept closed; one 0.4 candidate | None. Backward discovery already works from what a reader holds (nested origins, `stub_of`/`forked_from`, blogrolls); nothing derived may be published (no-metrics rule). |
| EX-16.6e | 16.6e | The manifest locates the surface (URI templates) | 0.4 construct — `feed`/`items` authoritative, `item`/`pin` RFC 6570 level-1 templates | The MVP keeps §4's fixed filenames (`blyg.json`, `feed.xml`, `items/{id}.json`, `items/{id}/v{n}.json`) and leaves the RFC 6570 level-1 expansion primitive in the oracle (`rfc6570Expand`) so the same templates can be adopted without a shape change. Template keys are never emitted. |
| EX-16.7a | 16.7 | Reserved — `![[id@vN]]` version-explicit transclusion | reserved — not an available construct | Publishers MUST reject `![[id@vN]]` at publish and readers MUST tolerate it as unknown (§10.1 rule 3). The MVP implements the reject/tolerate pair, not the construct. |
| EX-16.7b | 16.7 | Reserved — plain (non-structural) mentions | MAY — held apart as a lower class | The MVP does not accept plain mentions; the 'held apart' rule is documented for any future acceptance. No storage shape is committed. |
| EX-16.7c | 16.7 | Reserved — encrypted/permissioned content (L3) | reserved — L3 | None. The MVP stores and serves plaintext protocol content only. |
| EX-16.8 | 16.8 | What will never appear | never | None. These absences are load-bearing: the MVP must not synthesize any of them. |

## Traceability matrix

Grouped by owning module. `Keyword` is the RFC 2119 modal; `Optional` marks an
MVP-optional feature that is nonetheless made available (so it is in scope).

### `blyg/compose`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.3-3 | 5.3 | MUST | SUK-141 |  | `wire.item.invalid-thread-no-transclusions`<br>`wire.item.thread` | Threads additionally carry `transclusions`. |
| R5.6-4 | 5.6 | MUST NOT | SUK-141 |  | `compose.fork-flatten` | A fork copies the pinned document, not its composition; the blyg-transclusion class MUST NOT survive into the fork and inherited [[id]] links flatten to ordinary markdown links. |
| R5.6-6 | 5.6 | MUST NOT | SUK-141 |  | `compose.fork-custody-one-hop` | Custody runs one hop per fork; nothing carries verification through a chain of forks. |
| R5.7-3 | 5.7 | MUST NOT | SUK-141 |  | `compose.source-not-transclusion` | A generation source is not a transclusion: source references never appear in transclusions and never produce a blyg-transclusion blockquote. |
| R5.7-7 | 5.7 | SHOULD | SUK-141 |  | `compose.fork-flatten` | A publisher that knows a span is machine-generated SHOULD disclose it, including text generated outside the studio. |
| R9-5 | 9 | MUST NOT | SUK-141 |  | `compose.withdrawal-no-cascade` | Withdrawal does not cascade: a thread keeps its snapshot, a stub of a withdrawn item stays published, and a withdrawn stub SHOULD re-send its mention once. |
| R10.1-1 | 10.1 | MUST | SUK-141 |  | `compose.grammar-directive`<br>`compose.grammar-code-inert` | A line consisting solely of `![[` + a 26-char id + `]]` is a transclusion directive; elsewhere (inline, code spans, code blocks) the sequence is inert text. |
| R10.1-2 | 10.1 | MUST | SUK-141 |  | `compose.grammar-partial` | A directive immediately followed with no blank line by a markdown blockquote is a partial transclusion; a blank line detaches it. |
| R10.1-3 | 10.1 | MUST | SUK-141 |  | `compose.grammar-reserved-version`<br>`compose.grammar-inline-link` | `![[id@vN]]` is reserved: publishers MUST reject it at publish and readers MUST tolerate it as unknown. |
| R10.1-4 | 10.1 | MUST | SUK-141 |  | `compose.grammar-inline-link`<br>`compose.inline-link-silent` | `[[id]]` is a plain internal link that resolves at publish and renders as an absolute anchor; it is silent on the wire (no provenance, no mention, no relation); an unresolvable link MUST be a publish error. |
| R10.2-1 | 10.2 | MUST | SUK-141 |  | `compose.resolution-order-local`<br>`compose.resolution-order-imported`<br>`compose.resolution-ambiguous-error`<br>`compose.resolution-none-error` | Each directive MUST resolve local-published, else imported-current-or-pin-retained, else publish error; more than one imported match MUST be a publish error; drafts and L0 rows are errors. |
| R10.2-2 | 10.2 | MUST | SUK-141 |  | `wire.item.thread`<br>`compose.bake-own-and-remote` | The local snapshot is baked, never a live fetch, wrapped as <blockquote class="blyg-transclusion" data-blyg-id data-blyg-version> with data-blyg-origin only for remote sources; blyg-transclusion is a permanent wire token. |
| R10.2-3 | 10.2 | MUST | SUK-141 |  | `vector.partial.selection-substring`<br>`vector.partial.selection-not-substring`<br>`wire.item.thread` | A partial transclusion's selection MUST be a substring of the target's text content at the baked version; the bake is the selection's plain text, one <p> per line, plus the permanent blyg-partial class; there is no length cap. |
| R10.2-4 | 10.2 | MUST NOT | SUK-141 |  | `compose.plain-web-target` | A plain-web target gets an ordinary markdown blockquote (no selector, no blyg-transclusion), and may carry a frozen cited label. |
| R10.2-5 | 10.2 | MUST | SUK-141 |  | `compose.snapshot-independence`<br>`compose.closure-check` | Publish never depends on the network; a thread MUST NOT transclude a local thread whose transitive local transclusion closure contains its own id. |
| R10.2-6 | 10.2 | MUST | SUK-141 |  | `compose.republish-reresolve` | Republishing re-resolves every directive to the then-current local snapshot; a source withdrawn and not pin-retained is a publish error on republish. |
| R10.3-1 | 10.3 | MUST | SUK-141 |  | `wire.item.thread` | Thread documents carry a transclusions array in directive order of references naming the exact baked versions; origin is omitted for own-origin sources. |
| R10.3-2 | 10.3 | MAY | SUK-141 | ✔ | `wire.item.thread` | A partial transclusion's entry MAY carry a selector with REQUIRED exact and optional prefix/suffix. |
| R10.3-3 | 10.3 | MUST | SUK-141 |  | `wire.item.invalid-thread-no-transclusions`<br>`wire.item.withdrawn` | Fragments omit the transclusions key; threads always carry it (a withdrawn thread's endcap carries []); generation sources never appear here; a plain link produces no entry. |
| R10.4-1 | 10.4 | MUST NOT | SUK-141 |  | `compose.snapshot-independence` | Later edits, withdrawal, or pinning of a source do not change a thread's baked snapshot; transclusions[].version is provenance and there is no auto-pin. |
| R10.6-1 | 10.6 | MAY | SUK-141 | ✔ | `wire.item.stub` | A stub is a thread that MAY carry stub_of naming exactly one target; other transclusions are quotes, not additional targets. |
| R10.6-2 | 10.6 | MUST | SUK-141 | ✔ | `wire.item.stub`<br>`compose.stub-url-target` | The blyg-target stub_of shape requires origin; the plain-web shape is {url}; either MAY carry cited. |
| R10.6-3 | 10.6 | MUST | SUK-141 |  | `wire.item.stub` | At publish, if the body transcludes the stub's target, stub_of.version MUST equal the version actually baked; otherwise it keeps the value set at creation. |

### `blyg/export`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R4-2 | 4 | MUST NOT | SUK-138 |  | `publication.sample-blyg` | The file names within the surface (`blyg.json`, `feed.xml`, `items/...`) are protocol-fixed and MUST NOT vary per deployment. |
| R4-3 | 4 | MUST | SUK-138 |  | `wire.manifest.sample`<br>`publication.sample-blyg` | Publishers MUST serve the required surface: manifest, feed, archive index, canonical item documents, pinned version documents, media. |
| R4-4 | 4 | MUST | SUK-138 |  | `publication.sample-blyg` | The entire surface MUST be servable as plain static files; the Webmention endpoint is the one optional dynamic exception. |
| R4-5 | 4 | MUST | SUK-138 |  | `publication.sample-blyg` | `items/{id}.json` MUST 404 for unknown ids and never-published drafts, and MUST 200 permanently once the item has ever been published, including after withdrawal. |
| R4-6 | 4 | MUST | SUK-138 |  | `publication.sample-blyg` | `items/{id}/v{n}.json` MUST 404 unless version n is pinned, and MUST 200 permanently once it is. |
| R4-7 | 4 | SHOULD | SUK-138 |  | `publication.sample-blyg` | Public JSON and XML responses SHOULD be served with permissive CORS. |
| R4-8 | 4 | MUST NOT | SUK-138 |  | `vector.rfc822.saturday` | A publisher MUST NOT write local time into any protocol surface; all timestamps are ISO 8601 UTC except RSS RFC 822 dates inside feed.xml. |
| R5.8-2 | 5.8 | MUST | SUK-138 |  | `wire.item.withdrawn` | `page` is emitted for withdrawn items too; the endcap's page is 200 forever. |
| R5.8-4 | 5.8 | SHOULD | SUK-138 |  | `page-stability` | `page` SHOULD be stable for the life of the item; a publisher that must move a page SHOULD serve a redirect. |
| R8.4-1 | 8.4 | MUST NOT | SUK-138 |  | `publication.sample-blyg` | No route ever serves an unpinned older version; a version display MUST NOT offer, imply, or hint at access to unpinned history. |
| R9-2 | 9 | MUST | SUK-138 |  | `publication.sample-blyg` | The item document stays 200 forever; pinned versions remain fetchable forever. |
| R13.5-1 | 13.5 | MUST NOT | SUK-138 |  | `reconcile.no-re-emission`<br>`privacy.sample-publication` | Imported items are never re-emitted: they MUST NOT appear in the publisher's feed, archive index, or as item documents in any form. |
| R15.7-1 | 15.7 | MUST | SUK-144 | ✔ | `webmention.static-conformant` | A static-only deployment advertises no endpoint, receives nothing, and remains fully conformant at every level. |

### `blyg/feed`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R7-1 | 7 | MUST | SUK-138 |  | `publication.sample-blyg` | The feed is RSS 2.0 with the blyg: namespace https://blygger.org/ns/0.1, whose URI is permanent. |
| R7-10 | 7 | MUST | SUK-138 |  | `publication.sample-blyg` | <description> HTML MUST be self-contained with no dependence on the origin's stylesheets or scripts. |
| R7-11 | 7 | SHOULD | SUK-138 |  | `publication.sample-blyg` | When an item's author.name is present the publisher SHOULD emit <dc:creator>; the opaque author object never appears in the XML. |
| R7-12 | 7 | MUST | SUK-138 |  | `vector.rfc822.saturday` | pubDate/lastBuildDate use RFC 822; blyg:* timestamps stay ISO 8601. |
| R7-13 | 7 | MUST | SUK-138 |  | `publication.sample-blyg` | Publishers MUST emit <blyg:manifest>; it is the feed's upgrade hook. |
| R7-2 | 7 | SHOULD | SUK-138 |  | `publication.sample-blyg` | One <item> per publish event, newest first; the window SHOULD be bounded (recommended 50). |
| R7-3 | 7 | MUST | SUK-138 |  | `publication.sample-blyg` | GUIDs are per-version `blyg:{id}:v{n}` with isPermaLink="false". |
| R7-4 | 7 | MUST | SUK-138 |  | `publication.sample-blyg`<br>`model.feed.sample-head` | Each entry renders the item's latest content in <description> while keeping its own blyg:version and note. |
| R7-5 | 7 | MUST | SUK-138 |  | `vector.feed-title.note-and-excerpt`<br>`vector.feed-title.withdrawn`<br>`render.title-not-extracted` | Publishers MUST emit a derived <title> and MUST NOT read it back as an item field; the recommended derivation is `note — excerpt`, or excerpt alone; a withdrawal's title is the literal `withdrawn`. |
| R7-6 | 7 | MUST | SUK-138 |  | `publication.sample-blyg` | The entry <link> is the item's absolute page. |
| R7-7 | 7 | MUST | SUK-138 |  | `publication.sample-blyg`<br>`model.feed.sample-head` | A withdrawn item contributes exactly one entry (the withdrawal event, title `withdrawn`, empty description); its earlier events are dropped from the window. |
| R7-8 | 7 | MUST NOT | SUK-138 |  | `publication.sample-blyg` | Pinning emits no feed event. |
| R7-9 | 7 | MUST NOT | SUK-138 |  | `compose.no-feed-vocabulary` | Stubs and lineage add no feed vocabulary; any prepended citation/lineage line is presentation and not part of content_html. |
| R10.6-6 | 10.6 | MUST NOT | SUK-138 |  | `compose.no-feed-vocabulary` | Stubs add no feed vocabulary; a stub is a thread and appears as one. |

### `blyg/fetch`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R12.2-2 | 12.2 | MUST | SUK-139 |  | `resolution.redirect-bounded` | Redirects MUST be bounded (recommended 5) and the final URL wins as origin. |
| R12.3-1 | 12.3 | SHOULD | SUK-139 |  | `resolution.conditional-request` | Readers SHOULD poll with conditional requests and honor 304. |
| R12.3-2 | 12.3 | MUST NOT | SUK-139 |  | `resolution.backoff` | Readers SHOULD back off exponentially and honor Retry-After, and MUST NOT tighten their polling interval in response to failure; poll failure MUST NOT discard stored state. |
| R12.3-3 | 12.3 | SHOULD | SUK-139 |  | `resolution.user-agent` | Readers SHOULD send an identifying User-Agent. |
| R14-2 | 14 | SHOULD | SUK-139 |  | `resolution.fetch-hygiene` | Server-side readers SHOULD apply fetch hygiene: bounded redirects, response size and time limits, and refusal to fetch private-network addresses. |

### `blyg/hash`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.1-3 | 5.1 | MUST | SUK-137 |  | `vector.hash.content`<br>`vector.hash.empty`<br>`publication.sample-blyg` | `content_hash` MUST be "sha256:" + hex(SHA-256(content_md as UTF-8)), covering content_md only. |

### `blyg/ids`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.1-1 | 5.1 | MUST | SUK-137 |  | `vector.id.encode-zero`<br>`vector.id.decode-roundtrip`<br>`vector.id.valid`<br>`vector.id.invalid-excluded-char` | `id` MUST be 128 random bits encoded as 26 lowercase Crockford base32 chars, generated from a cryptographically strong source. |
| R5.1-2 | 5.1 | MUST NOT | SUK-137 |  | `compose.lineage-immutable` | Ids are permanent identity: they MUST NOT change across versions, withdrawal, or return. |

### `blyg/index`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R6.2-1 | 6.2 | MUST | SUK-138 |  | `wire.index.sample`<br>`publication.sample-blyg` | The archive index lists every item ever published including withdrawn, with no window, ordered by updated descending. |

### `blyg/item`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.2-1 | 5.2 | MUST | SUK-137 |  | `wire.item.fragment` | `version` is a positive integer incremented by exactly 1 per publish event; draft saves are invisible to the protocol. |
| R5.2-2 | 5.2 | MUST NOT | SUK-137 |  | `wire.item.fragment` | The version counter MUST NOT carry semantic versioning, edition, or significance markers. |
| R5.2-3 | 5.2 | MUST | SUK-137 |  | `wire.item.fragment`<br>`wire.pinned.fragment` | Only the latest version's content is served; older content is withheld unless pinned. The changelog is metadata, never diffs or content. |
| R5.2-4 | 5.2 | MUST NOT | SUK-137 |  | `compose.note-depth` | A changelog note MUST NOT reproduce withheld (unpinned) prior content. |
| R5.2-6 | 5.2 | MUST | SUK-137 |  | `publication.sample-blyg`<br>`wire.item.fragment` | `updated` MUST equal the latest changelog entry's `at`. |
| R5.5-1 | 5.5 | MUST | SUK-137 |  | `item.author-opaque`<br>`wire.item.fragment` | If present, `author` is a JSON object; readers MUST accept any object and MUST NOT reject an item over its author contents. |
| R5.5-3 | 5.5 | MUST | SUK-137 |  | `item.author-opaque` | Authors are never addressable; no protocol construct references an author. |
| R5.6-2 | 5.6 | MUST | SUK-137 |  | `wire.item.withdrawn` | Lineage survives withdrawal: the endcap keeps `forked_from`. |
| R5.7-1 | 5.7 | MAY | SUK-137 | ✔ | `wire.item.thread` | A publisher whose version contains machine-generated prose SHOULD disclose it via an optional `generated` array; sources names this origin's drawn-on versions and MAY be empty. |
| R5.7-4 | 5.7 | MUST | SUK-137 |  | `wire.item.withdrawn` | The `generated` key is omitted when no generation occurred; a withdrawal endcap never carries it; readers ignore the unknown key. |
| R5.7-6 | 5.7 | INFO | SUK-137 |  | `wire.item.thread` | `generated` is self-asserted and unverifiable; the protocol does not verify it. |
| R9-1 | 9 | MUST | SUK-137 |  | `wire.item.withdrawn`<br>`wire.item.invalid-withdrawn-content` | A withdrawal endcap empties content_md/content_html/media, sets kind withdrawn and updated, retains the changelog plus the endcap entry, empties a thread's transclusions, omits stub_of, never carries generated, and keeps page and forked_from. |

### `blyg/manifest`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R3.2-2 | 3.2 | SHOULD | SUK-138 |  | `wire.manifest.sample` | Publishers SHOULD emit `generator` in the form `name/version`. |
| R6.1-1 | 6.1 | MUST | SUK-138 |  | `wire.manifest.sample` | The manifest carries the required keys; blogroll and webmention are present only when the corresponding surface is served; site is self-asserted and advisory; level/generator/generator_url are informative. |
| R6.1-2 | 6.1 | SHOULD | SUK-138 |  | `wire.manifest.sample` | Publishers SHOULD emit `generator_url`; readers MUST NOT gate on it and its absence means only that nothing was stated. |
| R11-5 | 11 | MUST | SUK-138 |  | `wire.manifest.sample` | A blyg with nothing to show serves no blogroll.opml (404) and omits the manifest key. |
| R15.1-1 | 15.1 | MUST | SUK-138 | ✔ | `wire.manifest.sample` | A publisher that receives mentions carries a webmention URL in its manifest, present only when mentions are accepted; a static export omits it. |

### `blyg/markdown`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.2-7 | 5.2 | MUST | SUK-141 |  | `wire.item.fragment-media` | `content_html` MUST be self-contained; every URL in it MUST be absolute. media[].url is unaffected. |

### `blyg/media`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.4-1 | 5.4 | MUST | SUK-137 |  | `wire.item.fragment-media` | `media` entries carry `url` and `mime` and SHOULD carry `alt`. |
| R5.4-2 | 5.4 | MUST | SUK-137 |  | `media-immutability` | Media objects are immutable once published: a media URL MUST always serve the same bytes. |
| R8-4 | 8 | MUST | SUK-137 |  | `media-immutability` | Media referenced by any pinned version MUST be retained forever; pinned documents carry no media array. |

### `blyg/opml`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R11-1 | 11 | MUST | SUK-138 | ✔ | `model.blogroll.sample` | The blogroll is standard OPML 2.0 with no extensions served at blogroll.opml; each entry is one <outline type="rss"> with xmlUrl, htmlUrl and text/title. |
| R11-2 | 11 | MUST NOT | SUK-138 |  | `model.blogroll.sample` | No blyg-specific OPML attributes exist; consumers upgrade any entry's xmlUrl via the feed's <blyg:manifest> on resolve. |
| R11-4 | 11 | MUST NOT | SUK-138 |  | `model.blogroll.sample` | The blogroll is curated and claims no completeness; readers and crawlers MUST NOT treat it as everything the publisher follows. |

### `blyg/pins`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.7-5 | 5.7 | MUST | SUK-138 |  | `wire.pinned.fragment` | Pinned version files carry the pinned version's `generated` array. |
| R8-1 | 8 | MUST | SUK-138 |  | `publication.sample-blyg`<br>`wire.pinned.fragment` | A pin is irrevocable: the file MUST return 200 forever including after withdrawal; unpinned versions and unknown ids return 404. |
| R8-2 | 8 | MUST NOT | SUK-138 |  | `wire.pinned.invalid-withdrawn` | Any published version with content MAY be pinned including retroactively; withdrawal endcaps MUST NOT be pinned. |
| R8-3 | 8 | MUST | SUK-138 |  | `wire.pinned.fragment` | Pinning does not freeze the id; the live stream continues under the same identity. |
| R8-5 | 8 | MUST | SUK-138 |  | `wire.pinned.fragment` | Threads are pinnable; a pinned version carries its publish-time content_html, transclusions, generated, stub_of and forked_from. |
| R8-6 | 8 | MUST | SUK-138 |  | `wire.pinned.fragment` | author rides outside the pin promise; content_hash covers content_md only. |
| R10.6-4 | 10.6 | MUST | SUK-138 |  | `wire.item.withdrawn` | stub_of lives on versions; a pinned stub carries its own citation (spec 8) and a withdrawn stub's endcap omits it. |

### `blyg/reconcile`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R3-1 | 3 | MUST | SUK-140 |  | `reconcile.ignore-unknown` | A conforming reader MUST ignore constructs it does not understand rather than reject the document containing them. |
| R3.1-1 | 3.1 | MUST | SUK-140 |  | `reconcile.ignore-unknown` | Readers MUST accept any 0.x value of the manifest/item `blyg` key and apply the ignore-unknown rules. |
| R3.2-1 | 3.2 | MUST NOT | SUK-140 |  | `reconcile.no-gating` | Readers MUST NOT gate any behaviour (parsing, feature selection, trust) on `level`, `generator`, or `generator_url`. |
| R5.1-4 | 5.1 | MUST | SUK-140 |  | `reconcile.origin-scoping` | Readers MUST scope every id to the origin it was learned from; a publisher finding the same id at two imported origins treats it as ambiguous rather than picking one. |
| R5.2-5 | 5.2 | MUST NOT | SUK-140 | ✔ | `reconcile.no-gating` | A changelog entry MAY carry `generated: true`; it is self-asserted and readers MUST NOT gate on it. |
| R5.3-1 | 5.3 | MUST | SUK-140 |  | `wire.item.accept-unknown-kind` | Readers MUST treat unknown kinds as unknown constructs: ignore the item, do not reject the containing feed or archive. |
| R5.3-2 | 5.3 | MUST NOT | SUK-140 |  | `reconcile.long-fragment` | Publishers SHOULD cap fragment content_md at 2000 chars; readers MUST NOT reject long fragments. |
| R5.5-2 | 5.5 | MUST NOT | SUK-140 |  | `reconcile.origin-scoping` | Equal `author` values from different origins MUST NOT be treated as the same entity. |
| R5.5-4 | 5.5 | MUST | SUK-140 |  | `reconcile.author-passthrough` | Clients that store or re-emit item JSON MUST carry `author` verbatim, never synthesized or rewritten. |
| R8-7 | 8 | MUST | SUK-140 |  | `reconcile.withdrawal-retain-pinned` | A pin is the only thing lineage may point at and the only thing a reader may retain past withdrawal. |
| R9-3 | 9 | MUST | SUK-140 |  | `reconcile.withdrawal-drop-unpinned` | Conforming readers roll a withdrawn item up to null and drop it from the local archive. |
| R9-4 | 9 | MUST | SUK-140 |  | `reconcile.withdrawal-return` | Withdrawal is reversible: a later publish event under the same id is the item returning. |
| R10.3-5 | 10.3 | MUST | SUK-140 |  | `reconcile.origin-scoping` | Readers at L2 MUST scope a transclusion's id to its origin when present, and to the document's own origin when absent. |
| R13.1-1 | 13.1 | MUST | SUK-140 |  | `reconcile.feed-not-authoritative` | Readers MUST treat item documents as ground truth and the feed as a lossy signal. |
| R13.1-2 | 13.1 | MUST | SUK-140 |  | `reconcile.rollup-by-id` | Readers MUST roll up by blyg:id: highest version wins, ties broken by updated. |
| R13.1-3 | 13.1 | MUST | SUK-140 |  | `reconcile.withdrawal-drop-unpinned` | Readers MUST treat a withdrawal endcap as roll-up-to-null; a later version under the same id is the item returning. |
| R13.1-4 | 13.1 | MUST | SUK-140 |  | `reconcile.ignore-unknown` | Readers MUST ignore unknown kinds, unknown JSON members, unknown blyg:* XML elements, and reserved constructs without rejecting the containing document. |
| R13.1-5 | 13.1 | MUST NOT | SUK-140 |  | `reconcile.author-passthrough` | Readers MUST NOT reject an item over its author contents and MUST NOT treat equal author values from different origins as the same entity. |
| R13.1-6 | 13.1 | SHOULD | SUK-140 |  | `reconcile.index-gap-recovery` | Readers SHOULD backfill from items/index.json when the feed window has been missed. |
| R13.1-7 | 13.1 | MUST | SUK-140 |  | `reconcile.origin-scoping` | Readers MUST scope everything to the origin: ids, authors and trust do not transfer across origins. |
| R13.1-8 | 13.1 | MUST NOT | SUK-140 |  | `reconcile.no-gating` | Readers MUST NOT gate any behaviour on generator or level. |
| R13.2-1 | 13.2 | MUST | SUK-140 |  | `reconcile.index-gap-recovery` | The archive index is the reconciliation surface; the feed is a cheap trigger; feed-window gaps fall back to an index diff. |
| R13.2-2 | 13.2 | MUST NOT | SUK-140 |  | `reconcile.feed-not-authoritative`<br>`reconcile.poll-failure-no-mutation` | The feed never mutates state directly; only the fetched document advances state; poll failures MUST NOT alter stored item state. |
| R13.2-3 | 13.2 | MUST NOT | SUK-140 |  | `reconcile.malformed-entry-skip` | An unparseable feed goes straight to an index diff; an unparseable entry is skipped individually; the containing feed is not rejected. |
| R13.2-4 | 13.2 | SHOULD | SUK-140 |  | `reconcile.missing-index-lossy` | A 404 on items/index.json from an otherwise-live blyg is nonconforming; readers SHOULD fall back to feed-window-only operation and surface the subscription as lossy. |
| R13.3-1 | 13.3 | MUST NOT | SUK-140 |  | `reconcile.rollback-loud` | A fetched document whose version is lower than the watermark MUST NOT be silently adopted; the reader SHOULD surface it and MAY offer a user-confirmed reset. |
| R13.3-2 | 13.3 | SHOULD | SUK-140 |  | `reconcile.stealth-edit` | Same version but a different content_hash is a stealth edit: adopt the fetched content and record/surface the discrepancy; the watermark is unchanged. |
| R13.3-3 | 13.3 | SHOULD | SUK-140 |  | `reconcile.hash-mismatch` | Readers SHOULD verify content_hash against content_md on import; a mismatch is a discrepancy signal and the content is adopted anyway. |
| R13.4-1 | 13.4 | MUST | SUK-140 |  | `reconcile.withdrawal-drop-unpinned`<br>`reconcile.withdrawal-retain-pinned` | On withdrawal the reader rolls up to null: it MUST stop presenting withdrawn content and SHOULD delete its copy, except content corresponding to a pinned version MAY be retained with attribution. |
| R13.4-2 | 13.4 | MUST NOT | SUK-140 |  | `reconcile.withdrawal-retain-pinned` | Local hoarding past withdrawal is nonconforming; a pin-retained snapshot remains a valid transclusion source, an unretained withdrawn item does not. |
| R13.6-1 | 13.6 | MUST NOT | SUK-140 |  | `reconcile.l0-wrapper` | An L0 wrapper's synthetic id is never a valid blyg id and MUST NOT be exported or re-emitted; an L0 row is never a transclusion source; a response to an L0 entry is a {url} stub. |
| R13.6-2 | 13.6 | SHOULD | SUK-140 |  | `reconcile.l0-wrapper` | L0 content is the entry title linking to the entry URL plus its sanitized summary truncated to the fragment ethos; clients SHOULD mark L0 items visibly. |
| R13.6-3 | 13.6 | MUST | SUK-140 |  | `reconcile.l0-wrapper` | RSS has no versions: the same GUID returning changed content is a local version bump; there is no withdrawal and no archive index. |
| R13.7-1 | 13.7 | SHOULD | SUK-145 |  | `reconcile.ordering-policy` | Ordering the merged reading surface is the reader's own policy; readers SHOULD ensure a skewed or future-dated origin cannot permanently dominate the display order. |

### `blyg/reference`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.6-1 | 5.6 | MUST | SUK-141 |  | `wire.item.fork`<br>`compose.lineage-immutable` | `forked_from` is a reference with REQUIRED origin; the referenced version MUST be pinned; lineage is immutable and MUST NOT be addable/retargeted/cleared after creation. |
| R5.8-1 | 5.8 | SHOULD | SUK-141 | ✔ | `wire.item.fragment` | An item MAY carry `page`; readers SHOULD use it and MAY fall back to the f/{id}/ and t/{id}/ convention when absent. |
| R5.9-1 | 5.9 | MUST | SUK-141 |  | `wire.item.stub`<br>`wire.item.fork` | The reference shape is {origin, id, version}; origin is REQUIRED in forked_from and stub_of and OPTIONAL in transclusions (omitted = own origin). |
| R5.9-2 | 5.9 | MUST | SUK-141 |  | `vector.staleness.stale`<br>`vector.reference.equal` | `version` is the version the publisher actually saw/baked; direct staleness is checked by fetching {origin}items/{id}.json and comparing. |
| R5.9-3 | 5.9 | MUST NOT | SUK-141 | ✔ | `wire.item.stub`<br>`compose.cited-not-verified` | `cited` requires `retrieved` when present; it is self-asserted and frozen, MUST NOT be presented as verified/current or baked into content_html, and importers retain it verbatim. |
| R5.9-4 | 5.9 | MAY | SUK-141 | ✔ | `wire.item.stub` | The `cited` object is permitted in forked_from, stub_of and transclusions[]; pinned version files carry each reference's cited as they carry the reference itself. |
| R10.4-2 | 10.4 | MUST | SUK-141 |  | `vector.staleness.stale`<br>`vector.staleness.fresh` | Staleness is a direct relation only; there is no transitive notion of staleness. |

### `blyg/render`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.3-4 | 5.3 | MUST NOT | SUK-138 |  | `render.title-not-extracted` | Items are titleless; readers MUST NOT extract a title from content. |
| R5.6-5 | 5.6 | SHOULD | SUK-138 |  | `render.fork-lineage` | A fork's HTML page SHOULD show its lineage, linking the pinned version it names. |
| R5.7-8 | 5.7 | MUST | SUK-141 |  | `wire.item.thread`<br>`render.generated-span` | The renderer MUST wrap each generated span as <span class="blyg-tk-gen"> or <div class="blyg-tk-gen">; the class name is a permanent wire token. |
| R5.8-3 | 5.8 | SHOULD | SUK-138 |  | `publication.sample-blyg` | A permalink page SHOULD carry <link rel="alternate" type="application/json" href="{origin}items/{id}.json">. |
| R8.4-2 | 8.4 | MUST NOT | SUK-138 | ✔ | `render.pinned-page` | Optional pinned pages are gated exactly like the JSON and are not publish events: they MUST NOT appear in the feed or archive index; readers MUST NOT require them. |
| R11-3 | 11 | SHOULD | SUK-138 |  | `render.feed-page` | The manifest advertises the blogroll via the optional blogroll key and publishers SHOULD emit <link rel="blogroll"> on the HTML feed page. |
| R13.5-2 | 13.5 | MAY | SUK-138 | ✔ | `render.curation-list` | A client MAY display imported content publicly as curation with attribution and links, without any protocol surface; displayed copies follow §13.4 on withdrawal. |
| R13.5-3 | 13.5 | MUST NOT | SUK-144 |  | `webmention.curation-no-auto-publish` | The aggregator pattern: never re-emit, and never stub on the members' behalf; a plain RSS digest lives outside the blyg surface. |
| R14-1 | 14 | MUST | SUK-142 |  | `privacy.sample-publication` | Readers MUST sanitize or sandbox fetched content_html before rendering it, and MUST NOT assume a nested snapshot was sanitized by anyone; store verbatim, sanitize at render. |
| R15.1-2 | 15.1 | SHOULD | SUK-138 |  | `render.feed-page` | Permalink pages and the feed page SHOULD carry <link rel="webmention"> and SHOULD announce the endpoint in an HTTP Link header. |
| R15.5-1 | 15.5 | MUST NOT | SUK-144 |  | `webmention.curation-no-auto-publish` | Verified mentions are studio signals: never auto-published, never in the feed/index/item documents; a publisher MAY display them only as per-item curation. |

### `blyg/resolve`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R4-1 | 4 | MUST NOT | SUK-139 |  | `resolution.identity-origin` | Readers MUST NOT infer anything from the mount path; the surface is strictly origin-relative. |
| R12.1-1 | 12.1 | MUST | SUK-139 |  | `resolution.direct-blyg`<br>`resolution.feed-upgrade`<br>`resolution.rel-probe`<br>`resolution.conventional-mount`<br>`resolution.rss-fallback`<br>`resolution.failure` | Readers MUST implement the six-step resolution procedure in order (normalize, direct probe, feed upgrade, rel probe, conventional-mount probes, RSS fallback), at most 6 fetches, one rel hop. |
| R12.1-2 | 12.1 | MUST | SUK-139 |  | `resolution.rel-probe` | Readers MUST support the HTML <link rel="blyg"> element; supporting an equivalent HTTP Link header is OPTIONAL. |
| R12.2-1 | 12.2 | MUST NOT | SUK-139 |  | `resolution.identity-origin`<br>`resolution.site-disagreement` | Subscription identity is the final fetch origin, never the manifest's self-asserted site; a disagreement SHOULD be surfaced and the asserted value MUST NOT be adopted. |
| R12.2-3 | 12.2 | MUST | SUK-139 |  | `resolution.identity-change-confirm` | Adopting a new origin is an identity change and MUST be user-confirmed, never automatic. |

### `blyg/store`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R11-6 | 11 | MUST NOT | SUK-136 |  | `store.subscription-invisible` | There is no protocol follow: subscribing is invisible client-local state; no follower lists, requests, or follow objects. |

### `blyg/webmention`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.6-3 | 5.6 | SHOULD | SUK-144 |  | `webmention.send-remote-refs` | Cross-origin lineage is a remote reference and SHOULD send a mention whose relation is `fork`. |
| R10.3-4 | 10.3 | SHOULD | SUK-144 |  | `webmention.send-remote-refs` | A remote transclusions entry SHOULD send a mention whose relation is `transclusion`. |
| R10.6-5 | 10.6 | SHOULD | SUK-144 |  | `webmention.send-remote-refs` | A remote blyg-target stub SHOULD send a mention whose relation is `stub`; a {url} stub SHOULD send an ordinary Webmention if the target advertises an endpoint. |
| R15.2-1 | 15.2 | SHOULD | SUK-144 | ✔ | `webmention.send-remote-refs` | A publisher SHOULD send a mention for each remote reference in a newly published version (remote stub_of, transclusions entries with origin, cross-origin forked_from); same-origin references never generate mentions. |
| R15.2-2 | 15.2 | MUST | SUK-144 |  | `webmention.send-remote-refs` | source is the referencing item's absolute page; target is the target's absolute page (or the {url} for a plain-web stub). |
| R15.2-3 | 15.2 | MUST | SUK-144 |  | `webmention.discovery-order` | Endpoint discovery: the target origin's manifest webmention key, else W3C discovery on the target URL (Link header, then HTML link/a), else no endpoint (recorded, not retried). |
| R15.2-4 | 15.2 | MUST | SUK-144 |  | `webmention.retry-backoff` | Retry with backoff on network failure/5xx; 4xx is terminal except 429; any 2xx is sent. |
| R15.2-5 | 15.2 | MUST | SUK-144 |  | `webmention.republish-resend` | Republish re-sends only for references that are new or whose target version changed. |
| R15.2-6 | 15.2 | MUST | SUK-144 |  | `webmention.withdrawal-resend` | Withdrawal re-sends once for a withdrawn stub so the receiver marks the mention gone. |
| R15.2-7 | 15.2 | MUST NOT | SUK-144 |  | `webmention.fire-and-forget` | Delivery is fire-and-forget: publish MUST NOT block on it; outbound status is information, never a publish outcome. |

### `studio/store`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R5.7-2 | 5.7 | MUST NOT | SUK-136 |  | `privacy.sample-publication`<br>`store.generated-instructions-private` | The `generated` array MUST NOT carry instruction text or any other pre-generation authoring state. |

### `worker/webmention`

| ID | § | Keyword | Issue | Optional | Fixtures | Statement |
|---|---|---|---|:--:|---|---|
| R14-3 | 14 | MUST | SUK-144 |  | `webmention.verify-bounds` | The §15.4 verification bounds (fetch count, redirect count, time, body size) are MUSTs; the rate limit keeps the queue finite. |
| R15-1 | 15 | MUST | SUK-144 | ✔ | `webmention.verify-stub` | A receiver believes a mention only when the source's item document, fetched from the origin it claims, names the target with a reference. |
| R15.3-1 | 15.3 | MUST | SUK-144 |  | `webmention.receive-202` | The endpoint accepts POST application/x-www-form-urlencoded with source and target. |
| R15.3-2 | 15.3 | MUST | SUK-144 |  | `webmention.receive-400` | Syntactic checks return 400: both URLs absolute http(s); source != target; target within this blyg's own origin and naming a published item; an unknown item is 400; a withdrawn target is accepted. |
| R15.3-3 | 15.3 | MUST | SUK-144 |  | `webmention.receive-429` | Rate limits return 429: per source host, per coarser source group, and a global cap; a refused claim is never queued. |
| R15.3-4 | 15.3 | MUST | SUK-144 |  | `webmention.receive-202` | Accept returns 202, records the (source,target) pair as pending, and verifies asynchronously; a re-sent pair re-verifies rather than duplicating. |
| R15.4-1 | 15.4 | MUST | SUK-144 |  | `webmention.verify-bounds` | Verification is bounded: at most 2 fetches (3 under 0.4 templates), at most 3 redirects, 5 seconds per fetch, 1 MB per body. |
| R15.4-2 | 15.4 | MUST | SUK-144 |  | `webmention.verify-html-alternate` | GET source: JSON with a blyg key is the item document; HTML is followed via rel=alternate application/json; anything else fails. |
| R15.4-3 | 15.4 | MUST | SUK-144 |  | `webmention.verify-mirror-fails`<br>`webmention.verify-pinned-file-fails` | The item document's final URL MUST be exactly {origin}items/{id}.json for the document's own origin and id (normalized); a pinned version file never verifies a mention. |
| R15.4-4 | 15.4 | MUST | SUK-144 |  | `webmention.verify-withdrawn-gone` | A source document with kind withdrawn is gone. |
| R15.4-5 | 15.4 | MUST | SUK-144 |  | `webmention.verify-stub`<br>`webmention.verify-transclusion`<br>`webmention.verify-fork-pinned`<br>`webmention.verify-fork-unpinned-fails`<br>`webmention.verify-failed` | Relation in order: stub_of naming this blyg -> stub; else a transclusions entry with this blyg as origin -> transclusion; else forked_from naming a pinned version of the target -> fork; else failed; comparisons read identity members only and ignore cited. |
| R15.4-6 | 15.4 | MUST NOT | SUK-144 |  | `webmention.no-content-stored` | On success the receiver records id/origin/version/kind/relation/author/page; NO content is stored (a verified mention is a pointer). |
| R15.4-7 | 15.4 | MUST | SUK-144 |  | `webmention.reverify-becomes-gone` | A re-sent mention re-verifies and updates its record; a mention verified before that fails now becomes gone and the record is kept. |
| R15.6-1 | 15.6 | MUST | SUK-144 | ✔ | `webmention.plain-apart` | Plain (non-structural) mentions, if accepted, MUST be held apart from structurally verified mentions as a lower class. |

