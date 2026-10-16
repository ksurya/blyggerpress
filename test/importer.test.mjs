// Conformance tests for the reader import pipeline (spec §12.3, §13.2).
//
// These exercise the polling orchestrator end-to-end against the committed wire
// fixtures: first subscribe, conditional 304s, feed-window gap recovery, poll
// failures, a missing/lossy index, legacy L0 wrapping, and cross-origin scoping.
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeOrigin, contentHash } from "../src/blyg/primitives.mjs";
import { findRow, findIdAcrossOrigins } from "../src/blyg/reconcile.mjs";
import { createStore, subscribe, pollSubscription, pollAll } from "../src/blyg/importer.mjs";
import { createFixturePorts, blygResolver, remoteResolver, ORIGIN, REMOTE, NOW, readJson, readText } from "./helpers/fixture-ports.mjs";

const A_ID = "1jt332depwffcsyfz9txf8c9r9";
const W_ID = "3wh683yzk9m9byd7tr17fpaxfs";
const NEW_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaa";

function samplePorts(overrides) {
  return createFixturePorts({ mount: ORIGIN, dir: "sample-blyg", now: NOW, overrides });
}

async function subscribeSample(ports) {
  const res = await subscribe(createStore(), ORIGIN, { ...ports, resolveSubscription: blygResolver() });
  assert.equal(res.ok, true);
  return res.store;
}

// ------------------------------------------------------------- first subscribe

test("first subscribe performs a full index reconciliation and imports every item", async () => {
  const ports = samplePorts();
  const store = await subscribeSample(ports);
  const sub = store.subscriptions[0];

  const r = await pollSubscription(store, sub.id, ports);
  assert.equal(r.ok, true);
  assert.equal(r.mode, "index", "a first subscribe is a feed-window gap and falls back to the index diff");
  assert.equal(r.lossy, false);
  assert.equal(r.store.imported.length, 6);

  assert.equal(findRow(r.store, ORIGIN, A_ID).version, 3, "roll-up serves the latest version");
  assert.equal(findRow(r.store, ORIGIN, W_ID).dropped, true, "the index's withdrawn endcap rolls up to null");
  assert.equal(r.store.subscriptions[0].lastIndexAt, NOW);
  assert.ok(r.store.subscriptions[0].feedHead.startsWith("blyg:"), "the newest feed entry is remembered for gap detection");
});

test("a conditional 304 leaves stored items untouched", async () => {
  const ports = samplePorts();
  const store = await subscribeSample(ports);
  const subId = store.subscriptions[0].id;
  const first = await pollSubscription(store, subId, ports);
  const before = JSON.stringify(first.store.imported);

  const second = await pollSubscription(first.store, subId, ports);
  assert.equal(second.ok, true);
  assert.equal(second.mode, "trigger");
  assert.equal(second.feed, "not-modified");
  assert.equal(second.triggers.length, 0);
  assert.equal(JSON.stringify(second.store.imported), before, "a 304 mutates no item state");
});

// ------------------------------------------------------------- gap recovery

test("feed-window gap recovery: a missing head forces an index diff that backfills only what is missing", async () => {
  const ports = samplePorts();
  const store = await subscribeSample(ports);
  const subId = store.subscriptions[0].id;
  const first = await pollSubscription(store, subId, ports);
  assert.equal(first.store.imported.length, 6);

  // The window now scrolls past the previously newest entry, and a new item
  // has appeared in the complete index.
  const truncatedFeed = readText("fixtures/wire/sample-blyg/feed.xml").replace(/<item>[\s\S]*?<\/item>/, "");
  ports.setOverride(`${ORIGIN}feed.xml`, { status: 200, body: truncatedFeed, etag: 'W/"feed-v2"' });

  const newDoc = { ...readJson("fixtures/wire/sample-blyg/items/1jt332depwffcsyfz9txf8c9r9.json"), id: NEW_ID, version: 1, created: "2026-07-30T00:00:00Z", updated: "2026-07-30T00:00:00Z", content_md: "brand new", content_html: "<p>brand new</p>", content_hash: contentHash("brand new"), changelog: [{ version: 1, at: "2026-07-30T00:00:00Z" }] };
  ports.setOverride(`${ORIGIN}items/index.json`, {
    status: 200,
    body: JSON.stringify({ updated: "2026-07-30T00:00:00Z", items: [...readJson("fixtures/wire/sample-blyg/items/index.json").items, { id: NEW_ID, kind: "fragment", created: "2026-07-30T00:00:00Z", updated: "2026-07-30T00:00:00Z", version: 1 }] }),
  });
  ports.setOverride(`${ORIGIN}items/${NEW_ID}.json`, { status: 200, body: JSON.stringify(newDoc) });

  const second = await pollSubscription(first.store, subId, ports);
  assert.equal(second.ok, true);
  assert.equal(second.mode, "index", "a missed window falls back to an index diff");
  assert.deepEqual(second.index.fetched.map((f) => f.id), [NEW_ID], "backfill fetches only the missing document");
  assert.equal(second.store.imported.length, 7);
  assert.equal(findRow(second.store, ORIGIN, NEW_ID).contentMd, "brand new");
});

// ------------------------------------------------------------- failures

test("a poll failure schedules backoff and never mutates stored items or watermarks", async () => {
  const ports = samplePorts();
  const store = await subscribeSample(ports);
  const subId = store.subscriptions[0].id;
  const first = await pollSubscription(store, subId, ports);
  const before = JSON.stringify(first.store.imported);

  ports.setOverride(`${ORIGIN}feed.xml`, () => {
    throw new Error("network down");
  });
  const failed = await pollSubscription(first.store, subId, ports, { forceIndex: true });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "poll-failed");
  assert.equal(JSON.stringify(failed.store.imported), before, "poll failure leaves stored state unaltered");
  assert.ok(failed.store.subscriptions[0].backoffUntil > NOW, "retry is scheduled with backoff");

  const again = await pollSubscription(failed.store, subId, ports);
  assert.equal(again.ok, false);
  assert.equal(again.reason, "backoff", "backoff is honored before the next attempt");
});

test("an isolated item fetch failure does not corrupt the run", async () => {
  const ports = samplePorts();
  const store = await subscribeSample(ports);
  const subId = store.subscriptions[0].id;

  ports.setOverride(`${ORIGIN}items/${A_ID}.json`, () => {
    throw new Error("boom");
  });
  const r = await pollSubscription(store, subId, ports);
  assert.equal(r.ok, true);
  assert.equal(r.index.failures.some((f) => f.id === A_ID), true);
  assert.equal(r.store.imported.length, 5, "the other documents still reconcile; the failure is isolated");
});

// ------------------------------------------------------------- lossy index

test("a 404 archive index marks the subscription lossy and continues feed-window-only", async () => {
  const ports = samplePorts({ [`${ORIGIN}items/index.json`]: { status: 404, body: "" } });
  const store = await subscribeSample(ports);
  const subId = store.subscriptions[0].id;

  const r = await pollSubscription(store, subId, ports);
  assert.equal(r.ok, true);
  assert.equal(r.lossy, true);
  assert.equal(r.store.subscriptions[0].lossy, true, "the condition is recorded on the subscription");
  assert.ok(r.store.imported.length > 0, "feed-window-only operation continues");
  assert.deepEqual(r.index, null);
});

// ------------------------------------------------------------- legacy L0

test("legacy mode wraps the feed window as L0 rows (no index, no withdrawal)", async () => {
  const feedUrl = "https://interconnected.org/home/feed";
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Interconnected</title><link>https://interconnected.org/</link>
    <item><guid>tag:interconnected.org,2026:1</guid><link>https://interconnected.org/1</link><title>One</title><description><![CDATA[<p>Body one</p>]]></description><pubDate>Mon, 01 Jun 2026 00:00:00 GMT</pubDate></item>
    <item><guid>tag:interconnected.org,2026:2</guid><link>https://interconnected.org/2</link><title>Two</title><description><![CDATA[<p>Body two</p>]]></description><pubDate>Tue, 02 Jun 2026 00:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const ports = createFixturePorts({ now: NOW, overrides: { [feedUrl]: { status: 200, body: xml, etag: 'W/"l0"' } } });

  const sub = await subscribe(createStore(), feedUrl, {
    ...ports,
    resolveSubscription: async () => ({ mode: "legacy", identityOrigin: feedUrl, feedUrl, title: "Interconnected" }),
  });
  assert.equal(sub.ok, true);
  const r = await pollSubscription(sub.store, sub.subscription.id, ports);
  assert.equal(r.ok, true);
  assert.equal(r.mode, "legacy");
  assert.equal(r.wrapped, 2);
  assert.equal(r.store.imported.length, 2);
  assert.ok(r.store.imported.every((row) => row.l0 === true));
});

// ------------------------------------------------------------- cross-origin provenance

test("cross-origin provenance: imports stay scoped to their fetch origin", async () => {
  const remotePorts = createFixturePorts({ mount: REMOTE, dir: "remote-blyg", now: NOW });
  const remoteSub = await subscribe(createStore(), REMOTE, { ...remotePorts, resolveSubscription: remoteResolver() });
  const remotePoll = await pollSubscription(remoteSub.store, remoteSub.subscription.id, remotePorts);
  assert.equal(remotePoll.store.imported.length, 2);
  assert.ok(remotePoll.store.imported.every((row) => normalizeOrigin(row.origin) === normalizeOrigin(REMOTE)));

  const samplePortsImpl = samplePorts();
  const sampleStore = await subscribeSample(samplePortsImpl);
  const samplePoll = await pollSubscription(sampleStore, sampleStore.subscriptions[0].id, samplePortsImpl);

  // The same store now holds both origins; ids are scoped, never merged.
  const merged = { subscriptions: remotePoll.store.subscriptions, imported: [...remotePoll.store.imported, ...samplePoll.store.imported] };
  for (const row of merged.imported) {
    const origins = findIdAcrossOrigins(merged.imported, row.id).map(normalizeOrigin);
    assert.deepEqual([...new Set(origins)], [normalizeOrigin(row.origin)]);
  }
  assert.equal(merged.imported.length, 8);
});

test("pollAll polls every due subscription and isolates per-subscription failures", async () => {
  const ports = samplePorts();
  const store = await subscribeSample(ports);
  const res = await pollAll(store, ports);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].ok, true);
  assert.equal(res.store.imported.length, 6);
});
