// blyg/media — §5.4 media entries, their immutability, and §8 rule 4 retention.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidMediaEntry,
  normalizeMediaEntry,
  absoluteMediaUrl,
  isAbsoluteUrl,
  MediaLedger,
  createMediaLedger,
  ImmutableMediaError,
  pinnedMediaUrls,
} from "../src/blyg/media.mjs";
import { sha256HexOfBytes } from "../src/blyg/hash.mjs";
import { readJson, loadSampleItems } from "./helpers.mjs";

const MEDIA_FIXTURE = "fixtures/wire/sample-blyg/items/6y1e4khfxxckyd9dhwgrtv2dj4.json";

test("R5.4-1: a media entry is {url, mime, alt?}; alt is recommended not required", () => {
  assert.equal(isValidMediaEntry({ url: "media/x.png", mime: "image/png" }), true);
  assert.equal(isValidMediaEntry({ url: "media/x.png", mime: "image/png", alt: "a diagram" }), true);
  assert.equal(isValidMediaEntry({ url: "media/x.png" }), false, "mime is required");
  assert.equal(isValidMediaEntry({ mime: "image/png" }), false, "url is required");
  assert.equal(isValidMediaEntry({ url: 1, mime: "image/png" }), false);
  assert.equal(isValidMediaEntry({ url: "u", mime: "m", alt: 3 }), false);
  assert.equal(isValidMediaEntry(null), false);
  // Unknown members are permitted wire-side.
  assert.equal(isValidMediaEntry({ url: "u", mime: "m", width: 3 }), true);
});

test("normalizeMediaEntry keeps the wire allow-list and drops everything else", () => {
  const cleaned = normalizeMediaEntry({ url: "media/x.png", mime: "image/png", alt: "a", localPath: "/Users/x/secret.png", draftId: "draft-1" });
  assert.deepEqual(cleaned, { url: "media/x.png", mime: "image/png", alt: "a" });
  assert.throws(() => normalizeMediaEntry({ url: "u" }), /must be/);
});

test("R5.2-7: content_html uses the absolute media URL while media[].url stays origin-relative", () => {
  const doc = readJson(MEDIA_FIXTURE);
  const origin = doc.origin;
  assert.equal(doc.media[0].url, "media/x7f2.png");
  assert.ok(!isAbsoluteUrl(doc.media[0].url));
  assert.equal(absoluteMediaUrl(doc.media[0].url, origin), "https://example.com/blyg/media/x7f2.png");
  assert.ok(doc.content_html.includes(`src="https://example.com/blyg/media/x7f2.png"`));
  assert.ok(!doc.content_html.includes('src="media/x7f2.png"'));
});

test("absoluteMediaUrl passes absolute URLs through and resolves relative ones", () => {
  assert.equal(absoluteMediaUrl("https://cdn.example.com/a.png", "https://example.com/blyg/"), "https://cdn.example.com/a.png");
  assert.equal(absoluteMediaUrl("/root/a.png", "https://example.com/blyg/"), "https://example.com/root/a.png");
  assert.throws(() => absoluteMediaUrl("media/a.png"), /origin/);
  assert.throws(() => absoluteMediaUrl(""), /non-empty/);
});

test("R5.4-2: a media URL always serves the same bytes", () => {
  const ledger = createMediaLedger({ origin: "https://example.com/blyg/", hashBytes: sha256HexOfBytes });
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  ledger.register({ url: "media/x7f2.png", mime: "image/png", alt: "a diagram" }, { bytes });
  // Re-publishing identical bytes is fine.
  ledger.register({ url: "media/x7f2.png", mime: "image/png" }, { bytes });
  // Different bytes at the same URL is not.
  assert.throws(() => ledger.register({ url: "media/x7f2.png", mime: "image/png" }, { bytes: new Uint8Array([9, 9, 9]) }), ImmutableMediaError);
  // A different mime at the same URL is not either.
  assert.throws(() => ledger.register({ url: "media/x7f2.png", mime: "image/jpeg" }, { bytes }), ImmutableMediaError);
  // A fresh URL is fine.
  ledger.register({ url: "media/y.png", mime: "image/png" }, { bytes });
  assert.equal(ledger.record("media/y.png").mime, "image/png");
});

test("the ledger without byte evidence still locks the url/mime pair", () => {
  const ledger = new MediaLedger({ origin: "https://example.com/blyg/" });
  ledger.register({ url: "media/a.png", mime: "image/png" });
  assert.throws(() => ledger.register({ url: "media/a.png", mime: "image/gif" }), ImmutableMediaError);
});

test("R8-4: media referenced by any pinned version is retained forever", () => {
  const item = loadSampleItems().find((i) => i.id === "1jt332depwffcsyfz9txf8c9r9");
  // Give the pinned v2 a media entry to retain, as a real publication would.
  item.versions.find((v) => v.version === 2).media = [{ url: "media/x7f2.png", mime: "image/png" }];
  assert.deepEqual(pinnedMediaUrls(item), ["https://example.com/blyg/media/x7f2.png"]);
  const ledger = createMediaLedger({ origin: item.origin });
  ledger.absorbItem(item);
  assert.equal(ledger.isRetained("media/x7f2.png"), true);
  assert.deepEqual(ledger.retainedUrls(), ["https://example.com/blyg/media/x7f2.png"]);
});

test("a pinned document carries no media array (spec 8 rule 4)", () => {
  const item = loadSampleItems().find((i) => i.id === "1jt332depwffcsyfz9txf8c9r9");
  const pin = readJson("fixtures/wire/sample-blyg/items/1jt332depwffcsyfz9txf8c9r9/v2.json");
  assert.ok(!("media" in pin));
});

test("late byte evidence establishes a permanent digest baseline", () => {
  const ledger = createMediaLedger({ origin: "https://example.com/", hashBytes: sha256HexOfBytes });
  const entry = { url: "media/a.png", mime: "image/png" };
  ledger.register(entry);
  const bytes = new Uint8Array([1, 2, 3]);
  ledger.register(entry, { bytes });
  assert.equal(ledger.record(entry.url).digest, sha256HexOfBytes(bytes));
  assert.throws(() => ledger.register(entry, { bytes: new Uint8Array([9]) }), ImmutableMediaError);
  assert.throws(() => ledger.register({ ...entry, url: "other.png" }, { digest: "not-a-hash" }), /digest/);
});

test("URL aliases share one byte baseline and supplied digest must match bytes", () => {
  const ledger = createMediaLedger({ origin: "https://example.com/", hashBytes: sha256HexOfBytes });
  const entry = { url: "media/a.png", mime: "image/png" };
  const bytes = new Uint8Array([1]);
  ledger.register(entry, { bytes });
  assert.throws(() => ledger.register({ ...entry, url: "HTTPS://EXAMPLE.COM:443/media/a.png#preview" }, { bytes: new Uint8Array([9]) }), ImmutableMediaError);
  assert.throws(() => ledger.register({ ...entry, url: "media/b.png" }, { bytes, digest: "0".repeat(64) }), /does not match/);
});
