// Every requirement SUK-137 owns must be exercised by a real assertion here,
// not merely cited by a fixture. This file is the coverage contract: add a
// requirement to contracts/requirements.json under SUK-137 and this test fails
// until an implementation check is registered for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidId, newId } from "../src/blyg/ids.mjs";
import { contentHash, isContentHash, verifyContentHash } from "../src/blyg/hash.mjs";
import {
  validateItemDocument,
  buildItemDocument,
  isWithdrawn,
} from "../src/blyg/item.mjs";
import { isValidMediaEntry, MediaLedger, ImmutableMediaError, pinnedMediaUrls } from "../src/blyg/media.mjs";
import { createLifecycle, NoteDepthError } from "../src/blyg/lifecycle.mjs";
import { requirementsForIssue, loadCases, loadSampleItems, deepEqual } from "./helpers.mjs";

const ORIGIN = "https://example.com/blyg/";
const ID_A = "1jt332depwffcsyfz9txf8c9r9";
const ID_T = "3ev1cjtw7c6q5y8cd0r7aj3bhc";

function lc(instants = ["2026-07-17T18:00:00Z"]) {
  let t = 0;
  return createLifecycle({ origin: ORIGIN, clock: () => instants[Math.min(t++, instants.length - 1)], idFactory: () => ID_A });
}

function fragment(lifecycle, contentMd, at, extra = {}) {
  const d = lifecycle.newDraft({ kind: "fragment", contentMd, contentHtml: `<p>${contentMd}</p>`, ...extra });
  return lifecycle.publish(d.localId, { at });
}

// ---------------------------------------------------------------------------
// One implementation check per SUK-137 requirement. Each must throw or assert
// its way to a real failure if the behaviour regresses.
// ---------------------------------------------------------------------------
const COVERAGE = {
  "R5.1-1": () => {
    assert.equal(isValidId(newId()), true);
    assert.equal(isValidId("1jt332depwffcsyfz9txf8c9r9i"), false);
    assert.equal(isValidId("1jt332depwffcsyfz9txf8c9r9"), true);
  },
  "R5.1-2": () => {
    const lifecycle = lc(["2026-07-17T18:00:00Z", "2026-07-18T00:00:00Z", "2026-07-19T00:00:00Z"]);
    fragment(lifecycle, "v1", "2026-07-17T18:00:00Z");
    lifecycle.withdraw(ID_A, { at: "2026-07-18T00:00:00Z" });
    const back = lifecycle.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "back", contentHtml: "<p>back</p>" });
    lifecycle.publish(back.localId, { at: "2026-07-19T00:00:00Z" });
    assert.equal(lifecycle.itemDocument(ID_A).id, ID_A);
    assert.deepEqual(lifecycle.versions(ID_A).map((v) => v.version), [1, 2, 3]);
  },
  "R5.1-3": () => {
    const h = contentHash("Markdown source of the *latest* version.");
    assert.equal(h, "sha256:8399113ac7ca4b73410a45fe1117e00d9936134f04147879592d3884a6ec7537");
    assert.equal(h, "sha256:" + contentHash("Markdown source of the *latest* version.").slice(7));
    assert.equal(isContentHash(h), true);
    assert.equal(verifyContentHash("x", contentHash("x")), true);
  },
  "R5.2-1": () => {
    const lifecycle = lc();
    const draft = lifecycle.newDraft({ kind: "fragment", contentMd: "draft only", contentHtml: "<p>draft only</p>" });
    lifecycle.saveDraft(draft.localId, { contentMd: "draft only v2" });
    assert.equal(lifecycle.listItems().length, 0, "a draft save creates nothing");
    assert.equal(lifecycle.publish(draft.localId, { at: "2026-07-17T18:00:00Z" }).version, 1);
    const d2 = lifecycle.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
    assert.equal(lifecycle.publish(d2.localId, { at: "2026-07-17T19:00:00Z" }).version, 2);
  },
  "R5.2-2": () => {
    const lifecycle = lc();
    fragment(lifecycle, "only", "2026-07-17T18:00:00Z");
    const doc = lifecycle.itemDocument(ID_A);
    assert.equal(Number.isInteger(doc.version), true);
    // no edition/significance/marker members ride along with the counter
    for (const key of Object.keys(doc)) assert.ok(!/edition|significan|major|minor|patch|prerelease|beta|alpha/.test(key));
    assert.deepEqual(Object.keys(doc.changelog[0]).sort(), ["at", "note", "version"]);
  },
  "R5.2-3": () => {
    const lifecycle = lc();
    fragment(lifecycle, "SECRET withheld", "2026-07-17T18:00:00Z");
    const d2 = lifecycle.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "live", contentHtml: "<p>live</p>" });
    lifecycle.publish(d2.localId, { at: "2026-07-17T19:00:00Z" });
    const doc = lifecycle.itemDocument(ID_A);
    assert.equal(doc.content_md, "live");
    assert.ok(!JSON.stringify(doc).includes("SECRET withheld"));
    assert.equal(doc.changelog.length, 2);
    assert.ok(!Object.keys(doc.changelog[0]).includes("content_md"), "the changelog carries no content or diff");
  },
  "R5.2-4": () => {
    const lifecycle = lc();
    const withheld = "A long enough withheld sentence that a lazy note might quote it back verbatim.";
    fragment(lifecycle, withheld, "2026-07-17T18:00:00Z");
    const d2 = lifecycle.newDraft({ itemId: ID_A, kind: "fragment", contentMd: "v2", contentHtml: "<p>v2</p>" });
    assert.throws(() => lifecycle.publish(d2.localId, { at: "2026-07-17T19:00:00Z", note: withheld }), NoteDepthError);
  },
  "R5.2-6": () => {
    const lifecycle = lc();
    fragment(lifecycle, "v1", "2026-07-17T18:00:00Z");
    const doc = lifecycle.itemDocument(ID_A);
    assert.equal(doc.updated, doc.changelog.at(-1).at);
  },
  "R5.5-1": () => {
    const base = buildItemDocument(loadSampleItems().find((i) => i.id === ID_A));
    const opaque = { ...base, author: { name: "x", weird: { nested: [1, 2] }, "key with spaces": null } };
    assert.equal(validateItemDocument(opaque).valid, true);
    assert.equal(validateItemDocument({ ...base, author: "not an object" }).valid, false);
  },
  "R5.5-3": () => {
    for (const item of loadSampleItems()) {
      const doc = buildItemDocument(item);
      assert.ok(!Object.keys(doc).includes("author_id"), "no member addresses an author");
      for (const ref of [doc.forked_from, doc.stub_of, ...(doc.transclusions ?? [])].filter(Boolean)) {
        assert.ok("id" in ref, "a reference names an item, never an author");
        if ("author" in ref) assert.equal(typeof ref.author, "string", "a cited author is a plain frozen label, not an entity");
      }
    }
  },
  "R5.6-2": () => {
    const lineage = { origin: "https://blyg.protocol-institute.org/", id: "7gvp7ms7wq4nks6erdbbdp8cqc", version: 1 };
    const lifecycle = lc(["2026-07-24T09:00:00Z", "2026-07-24T10:00:00Z"]);
    const d = lifecycle.newDraft({ kind: "fragment", contentMd: "fork", contentHtml: "<p>fork</p>", forkedFrom: lineage });
    lifecycle.publish(d.localId, { at: "2026-07-24T09:00:00Z" });
    lifecycle.withdraw(ID_A, { at: "2026-07-24T10:00:00Z" });
    const doc = lifecycle.itemDocument(ID_A);
    assert.equal(doc.kind, "withdrawn");
    assert.deepEqual(doc.forked_from, lineage);
  },
  "R5.7-1": () => {
    const thread = loadSampleItems().find((i) => i.id === ID_T);
    const doc = buildItemDocument(thread);
    assert.ok(Array.isArray(doc.generated) && doc.generated.length >= 1);
    assert.ok(doc.generated.every((g) => Array.isArray(g.sources)));
    // sources names this origin's drawn-on versions and MAY be empty
    assert.equal(validateItemDocument({ ...doc, generated: [{ sources: [] }] }).valid, true);
  },
  "R5.7-4": () => {
    const lifecycle = lc(["2026-07-17T18:00:00Z", "2026-07-17T19:00:00Z"]);
    fragment(lifecycle, "no generation here", "2026-07-17T18:00:00Z");
    assert.ok(!("generated" in lifecycle.itemDocument(ID_A)), "generated is omitted when no generation occurred");
    lifecycle.withdraw(ID_A, { at: "2026-07-17T19:00:00Z" });
    assert.ok(!("generated" in lifecycle.itemDocument(ID_A)), "an endcap never carries generated");
    // a reader ignores the unknown key rather than rejecting the document
    const withUnknown = { ...buildItemDocument(loadSampleItems().find((i) => i.id === ID_A)), generated: [{ sources: [] }] };
    assert.equal(validateItemDocument(withUnknown).valid, true);
  },
  "R5.7-6": () => {
    // generated is self-asserted and unverifiable: a span naming a nonexistent
    // source is still accepted, and the publisher passes it through verbatim.
    const phantom = { sources: [{ id: "00000000000000000000000000", version: 9 }], model: "m", at: "2026-07-20T09:50:00Z" };
    const lifecycle = createLifecycle({ origin: ORIGIN, clock: () => "2026-07-19T08:00:00Z", idFactory: () => ID_T });
    const d = lifecycle.newDraft({ kind: "thread", contentMd: "t", contentHtml: "<p>t</p>", transclusions: [], generated: [phantom] });
    lifecycle.publish(d.localId, { at: "2026-07-19T08:00:00Z" });
    assert.deepEqual(lifecycle.itemDocument(ID_T).generated, [phantom]);
    assert.equal(validateItemDocument(lifecycle.itemDocument(ID_T)).valid, true);
  },
  "R9-1": () => {
    const lifecycle = lc(["2026-07-22T09:00:00Z", "2026-07-23T09:00:00Z"]);
    const lineage = { origin: "https://blyg.protocol-institute.org/", id: "7gvp7ms7wq4nks6erdbbdp8cqc", version: 1 };
    const d = lifecycle.newDraft({ kind: "fragment", contentMd: "body", contentHtml: "<p>body</p>", media: [{ url: "media/x.png", mime: "image/png" }], forkedFrom: lineage });
    lifecycle.publish(d.localId, { at: "2026-07-22T09:00:00Z" });
    lifecycle.withdraw(ID_A, { at: "2026-07-23T09:00:00Z", note: "withdrawn" });
    const doc = lifecycle.itemDocument(ID_A);
    assert.equal(doc.kind, "withdrawn");
    assert.equal(doc.content_md, "");
    assert.equal(doc.content_html, "");
    assert.deepEqual(doc.media, []);
    assert.equal(doc.updated, "2026-07-23T09:00:00Z");
    assert.deepEqual(doc.changelog.map((e) => e.version), [1, 2]);
    assert.ok(!("stub_of" in doc) && !("generated" in doc));
    assert.equal(doc.page, `f/${ID_A}/`);
    assert.deepEqual(doc.forked_from, lineage);
    assert.equal(isWithdrawn(lifecycle.snapshot(ID_A)), true);
  },
  "R5.4-1": () => {
    assert.equal(isValidMediaEntry({ url: "media/x.png", mime: "image/png", alt: "a diagram" }), true);
    assert.equal(isValidMediaEntry({ url: "media/x.png", mime: "image/png" }), true);
    assert.equal(isValidMediaEntry({ url: "media/x.png" }), false);
  },
  "R5.4-2": () => {
    const ledger = new MediaLedger({ origin: ORIGIN });
    ledger.register({ url: "media/x.png", mime: "image/png" });
    assert.throws(() => ledger.register({ url: "media/x.png", mime: "image/gif" }), ImmutableMediaError);
  },
  "R8-4": () => {
    const item = loadSampleItems().find((i) => i.id === ID_A);
    item.versions.find((v) => v.version === 2).media = [{ url: "media/x.png", mime: "image/png" }];
    assert.deepEqual(pinnedMediaUrls(item), ["https://example.com/blyg/media/x.png"]);
    const ledger = new MediaLedger({ origin: item.origin });
    ledger.absorbItem(item);
    assert.equal(ledger.isRetained("media/x.png"), true);
    // a pinned document carries no media array
    const l = lc();
    fragment(l, "x", "2026-07-17T18:00:00Z");
    l.pin(ID_A, 1);
    assert.ok(!("media" in l.pinnedDocument(ID_A, 1)));
  },
};

const sukr = requirementsForIssue("SUK-137");

test("SUK-137 owns exactly the requirements this file covers", () => {
  const ids = new Set(sukr.map((r) => r.id));
  const covered = new Set(Object.keys(COVERAGE));
  for (const id of ids) assert.ok(covered.has(id), `SUK-137 requirement ${id} has no implementation check`);
  for (const id of covered) assert.ok(ids.has(id), `coverage entry ${id} is not a SUK-137 requirement`);
  assert.equal(ids.size, covered.size);
});

test("each SUK-137 requirement's cited fixture is defined by a case file", () => {
  const defined = new Set(loadCases().map((c) => c.id));
  for (const r of sukr) {
    for (const fx of r.fixtures) assert.ok(defined.has(fx), `${r.id}: fixture '${fx}' is not defined`);
  }
});

test("every SUK-137 requirement passes its implementation check", () => {
  for (const [id, check] of Object.entries(COVERAGE)) {
    assert.doesNotThrow(check, `requirement ${id} is not satisfied`);
  }
});

test("SUK-137's owned modules are all implemented", () => {
  const modules = new Set(sukr.map((r) => r.module));
  assert.deepEqual([...modules].sort(), ["blyg/hash", "blyg/ids", "blyg/item", "blyg/media"]);
});
