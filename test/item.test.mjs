// blyg/item — §5 canonical item document and publisher strictness, checked
// against every item-shaped conformance case.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateItemDocument,
  validatePublisherItem,
  buildItemDocument,
  changelogFromVersions,
  visibleVersions,
  hiddenVersions,
  isWithdrawn,
  isReference,
  isAbsoluteReference,
  isStubOf,
  isGeneratedSpan,
  AUTHORED_KINDS,
} from "../src/blyg/item.mjs";
import { casesWhere, readJson, loadSampleItems } from "./helpers.mjs";

const itemCases = casesWhere((c) => c.check === "schema" && c.schema === "item");

test("every item schema case is present and runs the reader validator", () => {
  assert.ok(itemCases.length >= 8, "expected the item schema family");
  for (const c of itemCases) {
    const doc = c.input.$file ? readJson(c.input.$file) : c.input;
    const { valid, errors } = validateItemDocument(doc);
    assert.equal(valid, c.expect.valid, `${c.id}: ${errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  }
});

test("R5.1-1: an id that is not canonical Crockford base32 is rejected", () => {
  const c = itemCases.find((x) => x.id === "wire.item.invalid-id");
  assert.ok(c);
  const { valid, errors } = validateItemDocument(c.input);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === "$.id"));
});

test("R5.1-3: a malformed content_hash shape is rejected", () => {
  const c = itemCases.find((x) => x.id === "wire.item.invalid-hash-shape");
  const { valid, errors } = validateItemDocument(c.input);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.path === "$.content_hash"));
});

test("R9-1: a withdrawal endcap with leftover content is rejected", () => {
  const c = itemCases.find((x) => x.id === "wire.item.invalid-withdrawn-content");
  const { valid } = validateItemDocument(c.input);
  assert.equal(valid, false);
});

test("R5.5-1: readers accept any author object and reject a non-object author", () => {
  const opaque = itemCases.find((x) => x.id === "item.author-opaque");
  const shape = itemCases.find((x) => x.id === "item.author-invalid-shape");
  assert.equal(validateItemDocument(opaque.input).valid, true);
  assert.equal(validateItemDocument(shape.input).valid, false);
  assert.ok(validateItemDocument(shape.input).errors.some((e) => e.path === "$.author"));
});

test("R5.5-3: authors are never addressable — no reference resolves to an author", () => {
  for (const item of loadSampleItems()) {
    const doc = buildItemDocument(item);
    if (doc.author) assert.equal(typeof doc.author, "object");
    // No reference-shaped member names an author; authors live only in `author`.
    for (const key of Object.keys(doc)) assert.ok(!key.startsWith("author_"));
  }
  assert.ok(!isReference({ name: "someone" }));
  assert.ok(!isAbsoluteReference({ name: "someone", id: "1jt332depwffcsyfz9txf8c9r9", version: 1 }));
});

test("known kinds are fragment/thread/withdrawn; only the first two are authored", () => {
  assert.deepEqual(AUTHORED_KINDS, ["fragment", "thread"]);
});

test("publisher strictness: updated must equal the latest changelog at", () => {
  const item = loadSampleItems().find((i) => i.id === "1jt332depwffcsyfz9txf8c9r9");
  const doc = buildItemDocument(item);
  assert.equal(validatePublisherItem(doc).valid, true);
  const broken = { ...doc, updated: "2000-01-01T00:00:00Z" };
  assert.equal(validatePublisherItem(broken).valid, false);
  assert.ok(validatePublisherItem(broken).errors.some((e) => e.path === "$.updated"));
});

test("publisher strictness: version equals the changelog length and increments by one", () => {
  const item = loadSampleItems().find((i) => i.id === "1jt332depwffcsyfz9txf8c9r9");
  const doc = buildItemDocument(item);
  const broken = { ...doc, changelog: [doc.changelog[0], { ...doc.changelog[2] }] };
  const res = validatePublisherItem(broken);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => e.path === "$.version"));
  assert.ok(res.errors.some((e) => /increment by exactly 1/.test(e.message)));
});

test("publisher strictness: content_hash must cover content_md", () => {
  const doc = buildItemDocument(loadSampleItems().find((i) => i.id === "6y1e4khfxxckyd9dhwgrtv2dj4"));
  const broken = { ...doc, content_hash: "sha256:" + "0".repeat(64) };
  assert.equal(validatePublisherItem(broken).valid, false);
  assert.ok(validatePublisherItem(broken).errors.some((e) => e.path === "$.content_hash"));
});

test("R5.2-3: only the latest version is served; older content is withheld unless pinned", () => {
  const item = loadSampleItems().find((i) => i.id === "1jt332depwffcsyfz9txf8c9r9");
  const visible = visibleVersions(item).map((v) => v.version).sort((a, b) => a - b);
  assert.deepEqual(visible, [2, 3], "the live version and the pin are routable");
  assert.deepEqual(hiddenVersions(item).map((v) => v.version), [1], "v1 is withheld");
});

test("R5.7-1/R5.7-6: a generated span carries sources only, never instructions", () => {
  const thread = loadSampleItems().find((i) => i.id === "3ev1cjtw7c6q5y8cd0r7aj3bhc");
  const doc = buildItemDocument(thread);
  assert.ok(Array.isArray(doc.generated));
  for (const span of doc.generated) {
    assert.ok(isGeneratedSpan(span));
    for (const key of Object.keys(span)) assert.ok(["sources", "model", "at"].includes(key), `unexpected generated member ${key}`);
  }
});

test("R5.6-2: lineage rides on the version and survives the shape checks", () => {
  const fork = loadSampleItems().find((i) => i.id === "0ff73f8ranqzaf0b2n3qpxxzd7");
  assert.ok(isAbsoluteReference(fork.forkedFrom));
  const withdrawn = loadSampleItems().find((i) => i.id === "3wh683yzk9m9byd7tr17fpaxfs");
  const doc = buildItemDocument(withdrawn);
  assert.equal(doc.kind, "withdrawn");
  assert.ok(isAbsoluteReference(doc.forked_from), "the endcap keeps forked_from");
  assert.equal(isWithdrawn(withdrawn), true);
});

test("changelogFromVersions emits {version, at, note} and only flags when set", () => {
  const item = loadSampleItems().find((i) => i.id === "1jt332depwffcsyfz9txf8c9r9");
  assert.deepEqual(changelogFromVersions(item.versions), [
    { version: 1, at: "2026-07-17T18:00:00Z", note: null },
    { version: 2, at: "2026-07-17T21:12:00Z", note: "typo", pinned: true },
    { version: 3, at: "2026-07-18T09:30:00Z", note: "sharpened the claim" },
  ]);
});

test("stub_of accepts the blyg shape (origin required) and the plain-web {url} shape", () => {
  assert.equal(isStubOf({ url: "https://example.org/x" }), true);
  assert.equal(isStubOf({ id: "1jt332depwffcsyfz9txf8c9r9", version: 1 }), false);
  assert.equal(isStubOf({ origin: "https://example.com/blyg/", id: "1jt332depwffcsyfz9txf8c9r9", version: 1 }), true);
  const stub = loadSampleItems().find((i) => i.id === "7jbfafqm50v2w8xd9hkxz3yesh");
  assert.ok(isStubOf(buildItemDocument(stub).stub_of));
});

test("a partially-filled wedge: no item document before the first publish event", () => {
  const item = { id: "1jt332depwffcsyfz9txf8c9r9", origin: "https://example.com/blyg/", createdAt: "2026-07-17T18:00:00Z", kind: "fragment", versions: [] };
  assert.throws(() => buildItemDocument(item), /first publish event/);
});

test("publisher validation rejects non-object input without throwing", () => {
  for (const value of [null, undefined, 3, "item", []]) {
    assert.equal(validatePublisherItem(value).valid, false);
  }
});
