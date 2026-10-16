// Conformance tests for blyg/reconcile (spec §3, §9, §13).
//
// Each test cites the pinned fixtures it exercises (`fixtures/cases/40-reconcile.json`)
// and the requirement ids that own the behaviour. These are the executable
// counterpart to the documented scenarios in the contract layer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { isValidId, contentHash, normalizeOrigin } from "../src/blyg/primitives.mjs";
import { parseFeed } from "../src/blyg/feed-reader.mjs";
import {
  ensureStore,
  findRow,
  importCanonicalItem,
  retainPinnedVersion,
  reconcileIndex,
  feedTriggers,
  parseArchiveIndex,
  rollupById,
  observableRows,
  isTransclusionSource,
  findIdAcrossOrigins,
  isAmbiguousAcrossOrigins,
  syntheticL0Id,
  wrapLegacyEntry,
} from "../src/blyg/reconcile.mjs";
import { validate, createRegistry } from "../tools/lib/schema-validate.mjs";
import { ORIGIN, REMOTE, NOW, readJson, readText, ROOT } from "./helpers/fixture-ports.mjs";

const T = "2026-10-16T00:00:00Z";
const T2 = "2026-10-16T00:00:01Z";
const T3 = "2026-10-16T00:00:02Z";

const A = readJson("fixtures/wire/sample-blyg/items/1jt332depwffcsyfz9txf8c9r9.json");
const B = readJson("fixtures/wire/sample-blyg/items/6y1e4khfxxckyd9dhwgrtv2dj4.json");
const W = readJson("fixtures/wire/sample-blyg/items/3wh683yzk9m9byd7tr17fpaxfs.json");
const R1 = readJson("fixtures/wire/remote-blyg/items/7gvp7ms7wq4nks6erdbbdp8cqc.json");
const SAMPLE_INDEX = readJson("fixtures/wire/sample-blyg/items/index.json");

const install = (doc, { origin = ORIGIN, observedAt = T } = {}) =>
  importCanonicalItem(ensureStore({}), { origin, doc, observedAt });

// --------------------------------------------------------------- roll-up

test("reconcile.rollup-by-id — highest version wins, ties broken by updated", () => {
  const rows = [
    { origin: ORIGIN, id: A.id, version: 1, updated: "2026-07-17T18:00:00Z" },
    { origin: ORIGIN, id: A.id, version: 3, updated: "2026-07-18T09:30:00Z" },
    { origin: ORIGIN, id: A.id, version: 3, updated: "2026-07-19T09:30:00Z" },
  ];
  const winners = rollupById(rows);
  assert.equal(winners.length, 1);
  assert.equal(winners[0].version, 3);
  assert.equal(winners[0].updated, "2026-07-19T09:30:00Z");
});

test("importCanonicalItem — same version, older updated loses the tie and changes nothing", () => {
  const first = install(A);
  const older = { ...A, updated: "2026-07-17T00:00:00Z" };
  const r = importCanonicalItem(first.store, { origin: ORIGIN, doc: older, observedAt: T2 });
  assert.equal(r.outcome, "unchanged");
  assert.equal(r.store.imported[0].updated, A.updated);
});

// ------------------------------------------------------- ignore-unknown / no-gating

test("reconcile.ignore-unknown — unknown kinds, members and reserved constructs never reject the document", () => {
  const st = ensureStore({});
  const unknownKind = importCanonicalItem(st, { origin: ORIGIN, doc: { ...A, kind: "quiz" } });
  assert.equal(unknownKind.outcome, "ignored-unknown-kind");
  assert.equal(unknownKind.store.imported.length, 0);

  const noisy = {
    ...A,
    blyg: "0.9", // any 0.x is accepted (R3.1-1)
    extraMember: { nested: true },
    reserved: "![[aaaaaaaaaaaaaaaaaaaaaaaaaa@v1]]", // reserved construct, tolerated (EX-16.7a)
  };
  const r = importCanonicalItem(st, { origin: ORIGIN, doc: noisy, observedAt: T });
  assert.equal(r.outcome, "adopted");
  assert.equal(r.store.imported.length, 1);
});

test("reconcile.no-gating — level, generator, generator_url and the self-asserted generated flag are ignored", () => {
  const quiet = install(A);
  const loud = importCanonicalItem(ensureStore({}), {
    origin: ORIGIN,
    observedAt: T,
    doc: {
      ...A,
      blyg: "0.11",
      level: 3,
      generator: "junk/0.0.0",
      generator_url: "https://example.org/junk",
      changelog: A.changelog.map((c, i) => (i === A.changelog.length - 1 ? { ...c, generated: true } : c)),
    },
  });
  assert.equal(quiet.outcome, "adopted");
  assert.equal(loud.outcome, "adopted");
  assert.equal(loud.row.contentMd, quiet.row.contentMd);
  assert.equal(loud.row.discrepancies.length, 0);
});

// --------------------------------------------------- feed trigger / index surface

test("reconcile.feed-not-authoritative — the feed only yields triggers and never mutates state", () => {
  const st = ensureStore({});
  const model = parseFeed(readText("fixtures/wire/sample-blyg/feed.xml"), { baseUrl: `${ORIGIN}feed.xml` });
  const triggers = feedTriggers(st, { origin: ORIGIN, feedModel: model });
  assert.ok(triggers.length > 0, "the feed should trigger fetches");
  assert.equal(st.imported.length, 0, "the feed never advances stored state");
});

test("reconcile.index-gap-recovery — the index diff fetches only what is missing locally", async () => {
  const index = parseArchiveIndex(readText("fixtures/wire/sample-blyg/items/index.json"));
  const docs = {};
  for (const it of index.items) docs[it.id] = readJson(`fixtures/wire/sample-blyg/items/${it.id}.json`);

  const first = await reconcileIndex(ensureStore({}), { origin: ORIGIN, index, fetchItem: (id) => docs[id], observedAt: T });
  assert.equal(first.fetched.length, index.items.length);
  assert.equal(first.store.imported.length, index.items.length);

  let refetched = 0;
  const second = await reconcileIndex(first.store, { origin: ORIGIN, index, fetchItem: (id) => (refetched++, docs[id]), observedAt: T2 });
  assert.equal(refetched, 0, "an up-to-date index diff fetches nothing (backfill fetches only missing documents)");
  assert.ok(second.skipped.every((s) => s.reason === "up-to-date"));
});

test("reconcile.malformed-entry-skip — a bad entry is skipped; only a wholly unparseable feed throws", () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><link>L</link>
    <item><guid isPermaLink="false">blyg:${A.id}:v1</guid><link>l</link><title>x</title></item>
    <item><title>no identity</title></item>
    <item><guid isPermaLink="false">blyg:${B.id}:v1</guid><link>l</link><title>y</title></item>
  </channel></rss>`;
  const model = parseFeed(xml);
  assert.equal(model.entries.length, 3, "the containing feed is not rejected over one bad entry");
  const triggers = feedTriggers(ensureStore({}), { origin: ORIGIN, feedModel: model });
  assert.deepEqual(triggers.map((t) => t.id).sort(), [A.id, B.id].sort(), "identity-less entries are not blyg events");

  assert.throws(() => parseFeed("<html>not a feed</html>"), /not an RSS or Atom feed/);
});

test("reconcile.missing-index-lossy — an unavailable index degrades without touching stored rows", async () => {
  const seeded = install(A).store;
  const res = await reconcileIndex(seeded, { origin: ORIGIN, index: null, fetchItem: () => assert.fail("must not fetch") });
  assert.equal(res.lossy, true);
  assert.deepEqual(res.store.imported, seeded.imported);
});

test("reconcile.long-fragment — a long fragment is accepted, never truncated or rejected", () => {
  const long = "x".repeat(2500);
  const r = install({ ...A, content_md: long, content_html: `<p>${long}</p>`, content_hash: contentHash(long) });
  assert.equal(r.outcome, "adopted");
  assert.equal(r.row.contentMd.length, 2500);
});

// --------------------------------------------------------- watermark / rewrites

test("reconcile.rollback-loud — a version below the watermark is surfaced, never silently adopted", () => {
  const st = install(A).store; // watermark 3
  const older = { ...A, version: 2, updated: "2026-07-17T21:12:00Z", content_md: "older", content_html: "<p>older</p>", content_hash: contentHash("older") };
  const r = importCanonicalItem(st, { origin: ORIGIN, doc: older, observedAt: T2 });
  assert.equal(r.outcome, "version-regression");
  assert.equal(r.row.version, 3);
  assert.equal(r.row.watermark, 3);
  assert.equal(r.row.contentMd, A.content_md);
  assert.ok(r.row.discrepancies.some((d) => d.type === "version-regression"));
});

test("reconcile.stealth-edit — same version, different hash: adopt + record, watermark unchanged", () => {
  const st = install(A).store;
  const edited = { ...A, content_md: "stealth", content_html: "<p>stealth</p>", content_hash: contentHash("stealth") };
  const r = importCanonicalItem(st, { origin: ORIGIN, doc: edited, observedAt: T2 });
  assert.equal(r.outcome, "stealth-edit");
  assert.equal(r.row.contentMd, "stealth");
  assert.equal(r.row.watermark, 3);
  assert.ok(r.row.discrepancies.some((d) => d.type === "stealth-edit"));
});

test("reconcile.hash-mismatch — content_hash disagreement is a discrepancy, and the content is adopted anyway", () => {
  const bad = { ...A, content_hash: "sha256:" + "0".repeat(64) };
  const r = install(bad);
  assert.equal(r.outcome, "hash-mismatch");
  assert.equal(r.row.contentMd, A.content_md);
  assert.ok(r.row.discrepancies.some((d) => d.type === "hash-mismatch"));
});

// ------------------------------------------------------------- withdrawals

test("reconcile.withdrawal-drop-unpinned — roll up to null, delete the copy, remember the id", () => {
  const live = { ...W, kind: "fragment", version: 1, updated: "2026-07-22T09:00:00Z", content_md: "draft", content_html: "<p>draft</p>", content_hash: contentHash("draft"), changelog: [{ version: 1, at: "2026-07-22T09:00:00Z" }] };
  const st = install(live).store;
  const r = importCanonicalItem(st, { origin: ORIGIN, doc: W, observedAt: T2 });
  assert.equal(r.outcome, "withdrawn-dropped");
  assert.equal(r.row.kind, "withdrawn");
  assert.equal(r.row.presented, false);
  assert.equal(r.row.dropped, true);
  assert.equal(r.row.contentHtml, "");
  assert.equal(r.row.contentMd, null);
  assert.equal(r.row.watermark, 2, "the id is remembered so a later version is the return");
  assert.equal(observableRows(r.store).some((x) => x.id === W.id), false, "withdrawn-unretained drops from the presented archive");
});

test("reconcile.withdrawal-retain-pinned — a pin is the only thing retained past withdrawal", () => {
  const v2pin = readJson("fixtures/wire/sample-blyg/items/1jt332depwffcsyfz9txf8c9r9/v2.json");
  let st = install(A).store; // live at v3
  st = retainPinnedVersion(st, {
    origin: ORIGIN,
    id: A.id,
    version: 2,
    snapshot: { contentHash: v2pin.content_hash, contentHtml: v2pin.content_html, contentMd: v2pin.content_md, page: v2pin.page, kind: "fragment" },
    observedAt: T2,
  }).store;
  const endcap = { ...A, kind: "withdrawn", version: 4, updated: "2026-07-25T00:00:00Z", content_md: "", content_html: "", content_hash: contentHash(""), media: [] };
  const r = importCanonicalItem(st, { origin: ORIGIN, doc: endcap, observedAt: T3 });
  assert.equal(r.outcome, "withdrawn-retained");
  assert.equal(r.row.retainedPinnedVersion, 2);
  assert.equal(r.row.presented, true);
  assert.equal(r.row.dropped, false);
  assert.equal(r.row.contentMd, v2pin.content_md, "the retained snapshot is the pinned version's content");
  assert.equal(isTransclusionSource(r.row), true, "a pin-retained snapshot stays a valid transclusion source");
  assert.deepEqual(r.row.attribution, { origin: ORIGIN, id: A.id, version: 2, retained: true });

  const dropped = install(W).row;
  assert.equal(isTransclusionSource(dropped), false, "an unretained withdrawn item is not a transclusion source");
});

test("reconcile.withdrawal-return — a later version under the same id is the item returning", () => {
  let st = install(A).store;
  st = importCanonicalItem(st, {
    origin: ORIGIN,
    observedAt: T2,
    doc: { ...A, kind: "withdrawn", version: 4, content_md: "", content_html: "", content_hash: contentHash("") },
  }).store;
  assert.equal(findRow(st, ORIGIN, A.id).dropped, true);

  const returned = { ...A, version: 5, updated: "2026-07-26T00:00:00Z", content_md: "back", content_html: "<p>back</p>", content_hash: contentHash("back") };
  const r = importCanonicalItem(st, { origin: ORIGIN, doc: returned, observedAt: T3 });
  assert.equal(r.outcome, "adopted");
  assert.equal(r.row.id, A.id);
  assert.equal(r.row.dropped, false);
  assert.equal(r.row.presented, true);
  assert.equal(r.row.watermark, 5);
});

// ------------------------------------------------------------------ L0

test("reconcile.l0-wrapper — synthetic id, local version bump, no withdrawal, no index", () => {
  const origin = "https://interconnected.org/home/feed";
  const entry = { guid: "tag:interconnected.org,2026:1", link: "https://interconnected.org/1", title: "Hello", descriptionHtml: "<p>World</p>", pubDate: "2026-07-01T00:00:00Z" };
  const first = wrapLegacyEntry(ensureStore({}), { origin, entry, observedAt: T });
  assert.equal(first.outcome, "l0-wrapped");
  assert.equal(first.row.l0, true);
  assert.equal(isValidId(first.row.id), false, "an L0 id is never a valid blyg id");
  assert.ok(first.row.id.startsWith("l0-"));
  assert.equal(isTransclusionSource(first.row), false, "an L0 row is never a transclusion source");
  assert.match(first.row.contentHtml, /<a href="https:\/\/interconnected\.org\/1">Hello<\/a>/);

  const same = wrapLegacyEntry(first.store, { origin, entry, observedAt: T2 });
  assert.equal(same.outcome, "l0-unchanged");
  assert.equal(same.row.version, 1);

  const changed = wrapLegacyEntry(first.store, { origin, entry: { ...entry, descriptionHtml: "<p>Newer</p>" }, observedAt: T3 });
  assert.equal(changed.outcome, "l0-bumped");
  assert.equal(changed.row.version, 2, "a changed GUID is a local version bump");
  assert.equal(changed.row.watermark, 2);
});

test("syntheticL0Id — deterministic and never a valid blyg id", () => {
  assert.equal(syntheticL0Id("abc"), syntheticL0Id("abc"));
  assert.notEqual(syntheticL0Id("abc"), syntheticL0Id("abd"));
  assert.equal(isValidId(syntheticL0Id("abc")), false);
});

// ------------------------------------------------------- origin scoping

test("reconcile.origin-scoping — ids and equal authors never cross origins", () => {
  const sameIdElsewhere = { ...R1, origin: ORIGIN, author: { name: "Editor", url: REMOTE } };
  let st = importCanonicalItem(ensureStore({}), { origin: REMOTE, doc: R1, observedAt: T }).store;
  st = importCanonicalItem(st, { origin: ORIGIN, doc: sameIdElsewhere, observedAt: T }).store;

  assert.equal(st.imported.length, 2, "the same id at two origins is two rows");
  assert.deepEqual(findIdAcrossOrigins(st.imported, R1.id).sort(), [normalizeOrigin(REMOTE), normalizeOrigin(ORIGIN)].sort());
  assert.equal(isAmbiguousAcrossOrigins(st.imported, R1.id), true, "an id found at two imported origins is ambiguous");
  assert.notEqual(st.imported[0].author, st.imported[1].author, "equal author values are not the same entity");
});

test("reconcile.author-passthrough — the author object is carried verbatim and never rejected", () => {
  const weird = { name: "X", custom: { deep: [1, 2, 3] }, "\u{1F300}": true, url: "https://x.example/" };
  const r = install({ ...A, author: weird });
  assert.equal(r.outcome, "adopted");
  assert.deepEqual(r.row.author, weird);
});

test("origin disagreement is surfaced but the fetch origin remains identity", () => {
  const mirror = { ...A, origin: "https://mirror.example/" };
  const r = importCanonicalItem(ensureStore({}), { origin: ORIGIN, doc: mirror, observedAt: T });
  assert.equal(r.outcome, "adopted");
  assert.equal(r.row.origin, normalizeOrigin(ORIGIN));
  assert.ok(r.row.notices.some((n) => n.type === "origin-disagreement"));
});

// ---------------------------------------------- produced store stays schema-valid

test("the store produced by a full index reconciliation validates against the private-store schema", async () => {
  const schemas = readdirSync(join(ROOT, "contracts", "schemas"))
    .filter((f) => f.endsWith(".schema.json"))
    .map((f) => {
      const schema = readJson(`contracts/schemas/${f}`);
      return { id: schema.$id, schema };
    });
  const registry = createRegistry(schemas);
  const localStore = schemas.find((s) => s.id === "blygpress:local-store").schema;

  const index = parseArchiveIndex(readText("fixtures/wire/sample-blyg/items/index.json"));
  const docs = {};
  for (const it of index.items) docs[it.id] = readJson(`fixtures/wire/sample-blyg/items/${it.id}.json`);
  const res = await reconcileIndex(ensureStore({ schemaVersion: 1 }), { origin: ORIGIN, index, fetchItem: (id) => docs[id], observedAt: T });

  const { valid, errors } = validate(res.store, localStore, { registry, root: localStore });
  assert.equal(valid, true, JSON.stringify(errors, null, 2));
  assert.ok(res.store.imported.length > 0);
});
