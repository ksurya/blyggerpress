// blyg/lifecycle — the writer's state machine: drafts, publish events, pins,
// withdrawal and return (§5.2, §8, §9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createLifecycle, ImmutableFieldError, LifecycleError, NoteDepthError, assertNoteDepth } from "../src/blyg/lifecycle.mjs";
import { createMediaLedger } from "../src/blyg/media.mjs";
import { sha256HexOfBytes } from "../src/blyg/hash.mjs";
import { validatePublisherItem, isWithdrawn } from "../src/blyg/item.mjs";
import { publishEvents, publishEventCount, projectItemFiles, retainedMediaUrls } from "../src/blyg/publication.mjs";

import { createRegistry, validate } from "../tools/lib/schema-validate.mjs";
import { readJson } from "./helpers.mjs";

const schemas = ["common", "pinned-version"].map((name) => {
  const schema = readJson(`contracts/schemas/${name}.schema.json`);
  return { id: schema.$id, schema };
});
const registry = createRegistry(schemas);

const ORIGIN = "https://example.com/blyg/";
const ID_A = "1jt332depwffcsyfz9txf8c9r9";

function fixed(instants, ids = [ID_A]) {
  let t = 0;
  let i = 0;
  return createLifecycle({
    origin: ORIGIN,
    author: { name: "Venkatesh Rao", url: ORIGIN },
    clock: () => instants[Math.min(t++, instants.length - 1)],
    idFactory: () => ids[Math.min(i++, ids.length - 1)],
  });
}

function publishFragment(lc, { contentMd, contentHtml, at, note = null, noteGenerated = false } = {}) {
  const draft = lc.newDraft({ kind: "fragment", contentMd: contentMd ?? "x", contentHtml: contentHtml ?? "<p>x</p>" });
  return lc.publish(draft.localId, { at, note, noteGenerated });
}

test("R5.2-1: a draft save is invisible to the protocol", () => {
  const lc = fixed(["2026-07-17T18:00:00Z"]);
  const draft = lc.newDraft({ kind: "fragment", contentMd: "an unpublished idea", contentHtml: "<p>an unpublished idea</p>" });
  lc.saveDraft(draft.localId, { contentMd: "still unpublished" });
  assert.equal(lc.listItems().length, 0, "no item exists before the first publish event");
  assert.equal(lc.hasItem(ID_A), false);
  assert.equal(projectItemFiles(lc.listItems()).length, 0, "nothing is projected from a draft");
  assert.equal(lc.getDraft(draft.localId).contentMd, "still unpublished");
  // Only the publish event creates the item and the version.
  const result = lc.publish(draft.localId, { at: "2026-07-17T18:00:00Z" });
  assert.equal(result.version, 1);
  assert.equal(lc.itemDocument(ID_A).version, 1);
});

test("R5.2-1: version increments by exactly 1 per publish event", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z", "2026-07-17T20:00:00Z"]);
  publishFragment(lc, { contentMd: "v1", at: "2026-07-17T18:00:00Z" });
  const d2 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
  const r2 = lc.publish(d2.localId, { at: "2026-07-17T19:00:00Z" });
  const d3 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v3", contentHtml: "<p>v3</p>" });
  const r3 = lc.publish(d3.localId, { at: "2026-07-17T20:00:00Z" });
  assert.deepEqual([r2.version, r3.version], [2, 3]);
  assert.deepEqual(lc.versions(ID_A).map((v) => v.version), [1, 2, 3]);
});

test("R5.2-2: the counter is bare — no semantic or significance markers", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z"]);
  publishFragment(lc, { at: "2026-07-17T18:00:00Z" });
  const d2 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
  lc.publish(d2.localId, { at: "2026-07-17T19:00:00Z" });
  const doc = lc.itemDocument(ID_A);
  assert.equal(typeof doc.version, "number");
  assert.equal(doc.version, 2);
  for (const v of lc.versions(ID_A)) assert.equal(typeof v.version, "number");
});

test("R5.2-3: only the latest version is served; older content is withheld", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z"]);
  publishFragment(lc, { contentMd: "SECRET v1 body", at: "2026-07-17T18:00:00Z" });
  const d2 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2 body", contentHtml: "<p>v2 body</p>" });
  lc.publish(d2.localId, { at: "2026-07-17T19:00:00Z" });
  const doc = lc.itemDocument(ID_A);
  assert.equal(doc.content_md, "v2 body");
  assert.ok(!JSON.stringify(doc).includes("SECRET v1 body"), "the withheld body must not be served");
  // v1 is neither the live version nor pinned: no route may serve it.
  assert.throws(() => lc.pinnedDocument(ID_A, 1), /unknown version|withdrawal/);
  // Pinning v1 exposes exactly that withheld version (the publisher's right).
  lc.pin(ID_A, 1);
  assert.equal(lc.pinnedDocument(ID_A, 1).content_md, "SECRET v1 body");
});

test("R5.2-6: updated equals the latest changelog entry's at", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z"]);
  publishFragment(lc, { at: "2026-07-17T18:00:00Z" });
  const doc1 = lc.itemDocument(ID_A);
  assert.equal(doc1.updated, doc1.changelog.at(-1).at);
  const d2 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
  lc.publish(d2.localId, { at: "2026-07-17T19:00:00Z" });
  const doc2 = lc.itemDocument(ID_A);
  assert.equal(doc2.updated, "2026-07-17T19:00:00Z");
  assert.equal(doc2.updated, doc2.changelog.at(-1).at);
});

test("R5.2-4: a changelog note must not reproduce withheld prior content", () => {
  const withheld = "The withheld first version says something the note must never quote back.";
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z"]);
  publishFragment(lc, { contentMd: withheld, at: "2026-07-17T18:00:00Z" });
  const d2 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
  assert.throws(
    () => lc.publish(d2.localId, { at: "2026-07-17T19:00:00Z", note: `changed the line: ${withheld}` }),
    NoteDepthError,
  );
  // A descriptive note is fine, and generated notes are bound by the same rule.
  assert.doesNotThrow(() => assertNoteDepth(lc.versions(ID_A), "sharpened the claim"));
  // Once the prior version is pinned there is nothing withheld; a full note is allowed.
  lc.pin(ID_A, 1);
  const d3 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v3", contentHtml: "<p>v3</p>" });
  assert.doesNotThrow(() => lc.publish(d3.localId, { at: "2026-07-17T19:00:00Z", note: withheld }));
});

test("R5.1-2: the id is permanent across versions, withdrawal and return", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-18T00:00:00Z", "2026-07-19T00:00:00Z"]);
  publishFragment(lc, { at: "2026-07-17T18:00:00Z" });
  const d2 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
  lc.publish(d2.localId, { at: "2026-07-17T19:00:00Z" });
  lc.withdraw(ID_A, { at: "2026-07-18T00:00:00Z", note: "withdrawn" });
  const back = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "back", contentHtml: "<p>back</p>" });
  lc.publish(back.localId, { at: "2026-07-19T00:00:00Z" });
  assert.equal(lc.itemDocument(ID_A).id, ID_A);
  assert.equal(lc.snapshot(ID_A).id, ID_A);
});

test("R9-1: a withdrawal endcap empties content and media, keeps the changelog, page and lineage", () => {
  const lc = createLifecycle({
    origin: ORIGIN,
    author: { name: "A" },
    clock: () => "2026-07-17T18:00:00Z",
    idFactory: () => ID_A,
  });
  const draft = lc.newDraft({
    kind: "fragment",
    contentMd: "body",
    contentHtml: "<p>body</p>",
    media: [{ url: "media/x.png", mime: "image/png" }],
    forkedFrom: { origin: "https://blyg.protocol-institute.org/", id: "7gvp7ms7wq4nks6erdbbdp8cqc", version: 1 },
  });
  for (const entry of draft.media) lc.registerMedia(entry, { bytes: new Uint8Array([1]) });
  lc.publish(draft.localId, { at: "2026-07-17T18:00:00Z" });
  lc.withdraw(ID_A, { at: "2026-07-17T19:00:00Z", note: "withdrawn" });
  const doc = lc.itemDocument(ID_A);
  assert.equal(doc.kind, "withdrawn");
  assert.equal(doc.content_md, "");
  assert.equal(doc.content_html, "");
  assert.deepEqual(doc.media, []);
  assert.equal(doc.version, 2);
  assert.equal(doc.updated, "2026-07-17T19:00:00Z");
  assert.deepEqual(doc.changelog.map((e) => e.version), [1, 2]);
  assert.equal(doc.changelog.at(-1).note, "withdrawn");
  assert.ok(!("generated" in doc), "an endcap never carries generated");
  assert.ok(!("stub_of" in doc));
  assert.equal(doc.page, `f/${ID_A}/`);
  assert.deepEqual(doc.forked_from, { origin: "https://blyg.protocol-institute.org/", id: "7gvp7ms7wq4nks6erdbbdp8cqc", version: 1 });
  assert.equal(isWithdrawn(lc.snapshot(ID_A)), true);
});

test("R9-1: withdrawing a thread empties transclusions and omits stub_of", () => {
  const lc = fixed(["2026-07-19T08:00:00Z", "2026-07-19T09:00:00Z"], ["3ev1cjtw7c6q5y8cd0r7aj3bhc"]);
  const draft = lc.newDraft({
    kind: "thread",
    contentMd: "![[1jt332depwffcsyfz9txf8c9r9]]\n\nreply",
    contentHtml: "<p>reply</p>",
    transclusions: [{ id: "1jt332depwffcsyfz9txf8c9r9", version: 1 }],
    stubOf: { url: "https://example.org/target" },
  });
  lc.publish(draft.localId, { at: "2026-07-19T08:00:00Z" });
  assert.equal(lc.itemDocument("3ev1cjtw7c6q5y8cd0r7aj3bhc").stub_of.url, "https://example.org/target");
  lc.withdraw("3ev1cjtw7c6q5y8cd0r7aj3bhc", { at: "2026-07-19T09:00:00Z", note: "withdrawn" });
  const doc = lc.itemDocument("3ev1cjtw7c6q5y8cd0r7aj3bhc");
  assert.deepEqual(doc.transclusions, []);
  assert.ok(!("stub_of" in doc));
  assert.equal(doc.kind, "withdrawn");
  assert.equal(doc.page, "t/3ev1cjtw7c6q5y8cd0r7aj3bhc/");
});

test("R9-4: withdrawal is reversible — a later publish event is the return", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-18T00:00:00Z", "2026-07-19T00:00:00Z"]);
  publishFragment(lc, { contentMd: "SECRET first", at: "2026-07-17T18:00:00Z" });
  lc.withdraw(ID_A, { at: "2026-07-18T00:00:00Z" });
  const back = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "returned", contentHtml: "<p>returned</p>" });
  const r = lc.publish(back.localId, { at: "2026-07-19T00:00:00Z" });
  assert.equal(r.version, 3);
  const doc = lc.itemDocument(ID_A);
  assert.equal(doc.kind, "fragment");
  assert.equal(doc.content_md, "returned");
  assert.deepEqual(doc.changelog.map((e) => e.version), [1, 2, 3]);
  assert.ok(!JSON.stringify(doc).includes("SECRET first"), "the pre-withdrawal body stays withheld");
  assert.equal(doc.updated, "2026-07-19T00:00:00Z");
});

test("R5.6-2 and R5.6-1: lineage is immutable and survives withdrawal", () => {
  const lc = fixed(["2026-07-24T09:00:00Z", "2026-07-24T10:00:00Z"], ["0ff73f8ranqzaf0b2n3qpxxzd7"]);
  const lineage = { origin: "https://blyg.protocol-institute.org/", id: "7gvp7ms7wq4nks6erdbbdp8cqc", version: 1 };
  const draft = lc.newDraft({ kind: "fragment", contentMd: "fork", contentHtml: "<p>fork</p>", forkedFrom: lineage });
  lc.publish(draft.localId, { at: "2026-07-24T09:00:00Z" });
  // It cannot be added to, retargeted or cleared after creation.
  const edit = lc.newDraft({ itemId: "0ff73f8ranqzaf0b2n3qpxxzd7", kind: "fragment", contentMd: "edit", contentHtml: "<p>edit</p>" });
  assert.throws(() => lc.saveDraft(edit.localId, { forkedFrom: { origin: "https://x/", id: "0ff73f8ranqzaf0b2n3qpxxzd7", version: 1 } }), ImmutableFieldError);
  assert.throws(() => lc.newDraft({ itemId: "0ff73f8ranqzaf0b2n3qpxxzd7", kind: "fragment", forkedFrom: lineage }), ImmutableFieldError);
  lc.publish(edit.localId, { at: "2026-07-24T10:00:00Z" });
  lc.withdraw("0ff73f8ranqzaf0b2n3qpxxzd7", { at: "2026-07-24T11:00:00Z" });
  assert.deepEqual(lc.itemDocument("0ff73f8ranqzaf0b2n3qpxxzd7").forked_from, lineage);
});

test("R5.5-1 and R5.5-3: the author is preserved and never becomes addressable", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z"]);
  publishFragment(lc, { at: "2026-07-17T18:00:00Z" });
  const author = { name: "Venkatesh Rao", url: ORIGIN, nested: { anything: [1, 2] } };
  const lc2 = createLifecycle({ origin: ORIGIN, author, clock: () => "2026-07-17T18:00:00Z", idFactory: () => ID_A });
  const d = lc2.newDraft({ kind: "fragment", contentMd: "x", contentHtml: "<p>x</p>" });
  lc2.publish(d.localId, { at: "2026-07-17T18:00:00Z" });
  assert.deepEqual(lc2.itemDocument(ID_A).author, author);
  assert.throws(() => lc2.newDraft({ itemId: ID_A, kind: "fragment", author: { name: "someone else" } }), ImmutableFieldError);
});

test("R5.8: the page is fixed at first publish", () => {
  const lc = fixed(["2026-07-17T18:00:00Z"]);
  const draft = lc.newDraft({ kind: "fragment", page: "f/custom/", contentMd: "x", contentHtml: "<p>x</p>" });
  lc.publish(draft.localId, { at: "2026-07-17T18:00:00Z" });
  assert.equal(lc.itemDocument(ID_A).page, "f/custom/");
  const edit = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "y", contentHtml: "<p>y</p>" });
  assert.throws(() => lc.saveDraft(edit.localId, { page: "f/other/" }), ImmutableFieldError);
});

test("a publish event keeps the item's authored kind; a kind change is refused", () => {
  const lc = fixed(["2026-07-19T08:00:00Z", "2026-07-19T09:00:00Z"], ["3ev1cjtw7c6q5y8cd0r7aj3bhc"]);
  const draft = lc.newDraft({ kind: "thread", contentMd: "t", contentHtml: "<p>t</p>", transclusions: [] });
  lc.publish(draft.localId, { at: "2026-07-19T08:00:00Z" });
  assert.throws(() => lc.newDraft({ itemId: "3ev1cjtw7c6q5y8cd0r7aj3bhc", kind: "fragment", contentMd: "f", contentHtml: "<p>f</p>" }), /does not match/);
});

test("pinning adds no version, no publish event, and cannot pin an endcap", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z"]);
  publishFragment(lc, { at: "2026-07-17T18:00:00Z" });
  const eventsBefore = publishEventCount(lc.snapshot(ID_A));
  lc.pin(ID_A, 1);
  assert.equal(lc.versions(ID_A).length, 1, "pinning creates no version");
  assert.equal(publishEventCount(lc.snapshot(ID_A)), eventsBefore, "pinning emits no publish event");
  assert.equal(lc.itemDocument(ID_A).changelog[0].pinned, true);
  lc.withdraw(ID_A, { at: "2026-07-17T19:00:00Z" });
  assert.throws(() => lc.pin(ID_A, 2), /cannot be pinned/);
  assert.equal(lc.pinnedDocument(ID_A, 1).kind, "fragment", "a pinned content version is still fetchable after withdrawal");
});

test("an item's documents validate under publisher strictness and carry no drafts", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z", "2026-07-18T00:00:00Z"]);
  publishFragment(lc, { contentMd: "PRIVATE? no", at: "2026-07-17T18:00:00Z" });
  lc.pin(ID_A, 1);
  const d2 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
  lc.publish(d2.localId, { at: "2026-07-17T19:00:00Z" });
  lc.withdraw(ID_A, { at: "2026-07-18T00:00:00Z" });
  for (const doc of projectItemFiles(lc.listItems()).map((f) => f.value)) {
    const result = doc.pinned
      ? validate(doc, schemas[1].schema, { registry })
      : validatePublisherItem(doc);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
  }
  // A saved draft never appears in the projected text.
  const pending = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "DRAFT-ONLY-SECRET", contentHtml: "<p>d</p>" });
  lc.saveDraft(pending.localId, { contentMd: "DRAFT-ONLY-SECRET v2" });
  const corpus = JSON.stringify(projectItemFiles(lc.listItems()));
  assert.ok(!corpus.includes("DRAFT-ONLY-SECRET"), "an unpublished draft must not leak");
});

test("media on a pinned version is retained forever through the ledger", () => {
  const lc = fixed(["2026-07-18T12:00:00Z", "2026-07-18T13:00:00Z"], ["6y1e4khfxxckyd9dhwgrtv2dj4"]);
  const draft = lc.newDraft({
    kind: "fragment",
    contentMd: "A diagram: ![a diagram](media/x7f2.png)",
    contentHtml: '<p>A diagram: <img src="https://example.com/blyg/media/x7f2.png" alt="a diagram"></p>',
    media: [{ url: "media/x7f2.png", mime: "image/png", alt: "a diagram" }],
  });
  lc.registerMedia(draft.media[0], { bytes: new Uint8Array([1, 2, 3]) });
  lc.publish(draft.localId, { at: "2026-07-18T12:00:00Z" });
  lc.pin("6y1e4khfxxckyd9dhwgrtv2dj4", 1);
  assert.deepEqual(retainedMediaUrls(lc.listItems()), ["https://example.com/blyg/media/x7f2.png"]);
  const ledger = createMediaLedger({ origin: ORIGIN, hashBytes: sha256HexOfBytes });
  ledger.absorbItem(lc.snapshot("6y1e4khfxxckyd9dhwgrtv2dj4"));
  assert.equal(ledger.isRetained("media/x7f2.png"), true);
  assert.ok(!("media" in lc.pinnedDocument("6y1e4khfxxckyd9dhwgrtv2dj4", 1)));
});

test("a publish event requires an origin and a valid id from the factory", () => {
  const noOrigin = createLifecycle({ clock: () => "2026-07-17T18:00:00Z", idFactory: () => ID_A });
  const d = noOrigin.newDraft({ kind: "fragment", contentMd: "x", contentHtml: "<p>x</p>" });
  assert.throws(() => noOrigin.publish(d.localId), /origin/);
  const badId = createLifecycle({ origin: ORIGIN, clock: () => "2026-07-17T18:00:00Z", idFactory: () => "not-an-id" });
  const d2 = badId.newDraft({ kind: "fragment", contentMd: "x", contentHtml: "<p>x</p>" });
  assert.throws(() => badId.publish(d2.localId), /invalid id/);
});

test("a thread always carries transclusions and a fragment never does", () => {
  const lc = fixed(["2026-07-19T08:00:00Z"], ["3ev1cjtw7c6q5y8cd0r7aj3bhc"]);
  const thread = lc.newDraft({ kind: "thread", contentMd: "t", contentHtml: "<p>t</p>", transclusions: [] });
  lc.publish(thread.localId, { at: "2026-07-19T08:00:00Z" });
  const doc = lc.itemDocument("3ev1cjtw7c6q5y8cd0r7aj3bhc");
  assert.ok("transclusions" in doc, "a thread always carries the key, even empty");
  assert.deepEqual(doc.transclusions, []);
  assert.throws(() => lc.newDraft({ kind: "thread", contentMd: "t", contentHtml: "<p>t</p>" }), /always carries transclusions/);
  assert.throws(() => lc.newDraft({ kind: "fragment", contentMd: "f", contentHtml: "<p>f</p>", transclusions: [{ id: ID_A, version: 1 }] }), /fragment does not carry/);
});

test("publishEvents: one per version, newest first; a withdrawal collapses to one", () => {
  const lc = fixed(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z", "2026-07-18T00:00:00Z"]);
  publishFragment(lc, { contentMd: "v1", at: "2026-07-17T18:00:00Z" });
  const d2 = lc.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
  lc.publish(d2.localId, { at: "2026-07-17T19:00:00Z" });
  lc.pin(ID_A, 1);
  const events = publishEvents(lc.snapshot(ID_A));
  assert.deepEqual(events.map((e) => e.version), [2, 1], "newest first, pins add nothing");
  lc.withdraw(ID_A, { at: "2026-07-18T00:00:00Z" });
  const collapsed = publishEvents(lc.snapshot(ID_A));
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].kind, "withdrawn");
  assert.equal(collapsed[0].version, 3);
});

test("discarding a never-published draft is a hard delete", () => {
  const lc = fixed(["2026-07-17T18:00:00Z"]);
  const draft = lc.newDraft({ kind: "fragment", contentMd: "idea", contentHtml: "<p>idea</p>" });
  lc.discardDraft(draft.localId);
  assert.equal(lc.listDrafts().length, 0);
  assert.throws(() => lc.getDraft(draft.localId), LifecycleError);
});

test("failed publishes leave items and drafts unchanged", () => {
  const lc = fixed(["2026-07-17T18:00:00Z"]);
  const invalid = lc.newDraft({ contentMd: "x", contentHtml: "<p>x</p>", author: "invalid" });
  const before = lc.getDraft(invalid.localId);
  assert.throws(() => lc.publish(invalid.localId), /invariant/);
  assert.deepEqual(lc.listItems(), []);
  assert.deepEqual(lc.getDraft(invalid.localId), before);

  publishFragment(lc, { contentMd: "first" });
  const duplicate = lc.newDraft({ contentMd: "collision", contentHtml: "<p>x</p>" });
  const item = lc.snapshot(ID_A);
  assert.throws(() => lc.publish(duplicate.localId), /already exists/);
  assert.deepEqual(lc.snapshot(ID_A), item);
  assert.equal(lc.getDraft(duplicate.localId).itemId, null);

  const edit = lc.newDraft({ itemId: ID_A, contentMd: "second", contentHtml: "<p>x</p>", note: 42 });
  assert.throws(() => lc.publish(edit.localId), /invariant/);
  assert.deepEqual(lc.snapshot(ID_A), item);
});

test("document reads and saved patch objects cannot mutate publication state", () => {
  const lc = fixed(["2026-07-17T18:00:00Z"]);
  const draft = lc.newDraft({ kind: "thread", contentMd: "t", contentHtml: "<p>t</p>", transclusions: [] });
  const stub = { url: "https://example.org/original" };
  lc.saveDraft(draft.localId, { stubOf: stub });
  stub.url = "https://example.org/changed";
  lc.publish(draft.localId);
  lc.pin(ID_A, 1);
  const before = lc.snapshot(ID_A);
  for (const doc of [lc.itemDocument(ID_A), lc.pinnedDocument(ID_A, 1)]) {
    doc.author.name = "changed";
    doc.stub_of.url = "https://example.org/changed";
  }
  assert.deepEqual(lc.snapshot(ID_A), before);
  assert.equal(lc.itemDocument(ID_A).stub_of.url, "https://example.org/original");
});

test("publication references drop nested private fields and preserve opaque author", () => {
  const lc = fixed(["2026-01-01T00:00:00Z"]);
  const cited = { retrieved: "2026-01-01T00:00:00Z", source: "Source", draftText: "SECRET" };
  const ref = { origin: ORIGIN, id: ID_A, version: 1, cited, draftText: "SECRET" };
  const d = lc.newDraft({ kind: "thread", transclusions: [{ ...ref, selector: { exact: "quote", draftText: "SECRET" } }], forkedFrom: ref, stubOf: { url: "https://example.org/", cited, draftText: "SECRET" }, author: { custom: { label: "opaque" } } });
  lc.publish(d.localId);
  lc.pin(ID_A, 1);
  for (const doc of [lc.itemDocument(ID_A), lc.pinnedDocument(ID_A, 1)]) {
    assert.ok(!JSON.stringify(doc).includes("SECRET"));
    assert.deepEqual(doc.author, { custom: { label: "opaque" } });
    assert.equal(doc.transclusions[0].selector.exact, "quote");
  }
});

test("malformed citation shapes and ambiguous stubs fail before publication", () => {
  const lc = fixed(["2026-01-01T00:00:00Z"]);
  const ref = { origin: ORIGIN, id: ID_A, version: 1 };
  assert.throws(() => lc.newDraft({ forkedFrom: { ...ref, cited: {} } }), /forked_from/);
  assert.throws(() => lc.newDraft({ kind: "thread", transclusions: [], stubOf: { ...ref, url: "https://example.org/" } }), /stub_of/);
  assert.throws(() => lc.newDraft({ kind: "thread", transclusions: [], stubOf: { url: "https://example.org/", cited: {} } }), /stub_of/);
  assert.throws(() => lc.newDraft({ kind: "thread", transclusions: [{ ...ref, selector: { exact: "quote", prefix: 123 } }] }), /reference/);
});

test("media publication requires byte evidence and pins retain assets through withdrawal", () => {
  const lc = fixed(["2026-07-17T18:00:00Z"]);
  const media = { url: "media/a.png", mime: "image/png" };
  const draft = lc.newDraft({ contentMd: "image", contentHtml: '<img src="https://example.com/blyg/media/a.png">', media: [media] });
  assert.throws(() => lc.publish(draft.localId), /byte evidence/);
  assert.deepEqual(lc.listItems(), []);
  const bytes = new Uint8Array([1, 2, 3]);
  lc.registerMedia(media, { bytes });
  lc.publish(draft.localId);
  lc.pin(ID_A, 1);
  const pinBefore = lc.pinnedDocument(ID_A, 1);
  lc.withdraw(ID_A);
  assert.deepEqual(lc.pinnedDocument(ID_A, 1), pinBefore);
  assert.deepEqual(lc.retainedMediaUrls(), ["https://example.com/blyg/media/a.png"]);
  assert.throws(() => lc.registerMedia(media, { bytes: new Uint8Array([9]) }), /immutable/);
  lc.registerMedia({ ...media, url: "media/b.png" }, { bytes: new Uint8Array([9]) });
});

test("notes cannot embed an entire short withheld body in surrounding prose", () => {
  assert.throws(() => assertNoteDepth([{ version: 1, content_md: "private sentence" }], "Removed: private sentence."), NoteDepthError);
  assert.doesNotThrow(() => assertNoteDepth([{ version: 1, content_md: "private sentence", pinned: true }], "Removed: private sentence."));
});

test("generation disclosure strips authoring instructions and omits an empty disclosure", () => {
  const lc = fixed(["2026-07-17T18:00:00Z"]);
  const d = lc.newDraft({ generated: [{ sources: [], model: "m", instructions: "PRIVATE PROMPT" }] });
  lc.publish(d.localId);
  lc.pin(ID_A, 1);
  const before = lc.pinnedDocument(ID_A, 1);
  assert.deepEqual(before.generated, [{ sources: [], model: "m" }]);
  lc.saveDraft(d.localId, { generated: [] });
  lc.publish(d.localId);
  assert.ok(!("generated" in lc.itemDocument(ID_A)));
  assert.deepEqual(lc.pinnedDocument(ID_A, 1), before);
});
