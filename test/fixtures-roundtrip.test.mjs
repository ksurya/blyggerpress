// The implementation's builders are checked against the committed wire
// documents, and the shared publication checks are run over both the committed
// surface and a freshly projected item tree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { buildItemDocument, buildPinnedDocument, validatePublisherItem } from "../src/blyg/item.mjs";
import { projectItemFiles, serializeFiles, serialize } from "../src/blyg/publication.mjs";
import { PUB_CHECKS, ITEM_SCOPE_CHECKS } from "../tools/lib/publication-checks.mjs";
import { loadSampleItems, readJson, readText, repoPath, deepEqual, seedItemFromDocuments } from "./helpers.mjs";

const SAMPLE = "fixtures/wire/sample-blyg";

function writeProjection(dir, files) {
  for (const { path, body } of files) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, body);
  }
}

test("the canonical item document rebuilds the committed fixture byte-for-byte", () => {
  for (const item of loadSampleItems()) {
    const committed = readText(`${SAMPLE}/items/${item.id}.json`);
    const built = buildItemDocument(item);
    assert.ok(deepEqual(built, JSON.parse(committed)), `${item.id}: document differs`);
    assert.equal(serialize(built), committed, `${item.id}: serialization differs`);
    assert.equal(validatePublisherItem(built).valid, true, `${item.id}: publisher-strict validation`);
  }
});

test("the pinned version documents rebuild the committed fixtures", () => {
  for (const item of loadSampleItems()) {
    for (const v of item.versions.filter((x) => x.pinned)) {
      const committed = readJson(`${SAMPLE}/items/${item.id}/v${v.version}.json`);
      assert.ok(deepEqual(buildPinnedDocument(item, v.version), committed), `${item.id} v${v.version}: pinned document differs`);
    }
  }
});

test("item 1jt332... serves v3 and exposes only pinned v2 (§5.2, §8.4)", () => {
  const item = loadSampleItems().find((i) => i.id === "1jt332depwffcsyfz9txf8c9r9");
  const doc = buildItemDocument(item);
  assert.equal(doc.version, 3);
  assert.equal(doc.content_md, "Markdown source of the *latest* version.");
  assert.equal(doc.changelog[1].pinned, true);
  assert.equal(existsSync(repoPath(`${SAMPLE}/items/1jt332depwffcsyfz9txf8c9r9/v2.json`)), true);
  assert.equal(existsSync(repoPath(`${SAMPLE}/items/1jt332depwffcsyfz9txf8c9r9/v1.json`)), false, "v1 is withheld");
  assert.equal(existsSync(repoPath(`${SAMPLE}/items/1jt332depwffcsyfz9txf8c9r9/v3.json`)), false, "the live version is not a pin");
});

test("the remote pinned fragment rebuilds, and its pin is not in the changelog", () => {
  const dir = "fixtures/wire/remote-blyg/items/7gvp7ms7wq4nks6erdbbdp8cqc";
  const doc = readJson(`${dir}.json`);
  const pin = readJson(`${dir}/v1.json`);
  const item = seedItemFromDocuments(doc, [pin]);
  assert.ok(deepEqual(buildPinnedDocument(item, 1), pin), "remote pinned document differs");
  // The remote item document is an illustrative partial surface: its changelog
  // never marks the pin, which is exactly why the full publisher marks it.
  assert.equal(doc.changelog[0].pinned, undefined);
  assert.equal(buildItemDocument(item).changelog[0].pinned, true);
});

test("projectItemFiles reproduces every committed item file in the sample blyg", () => {
  const files = serializeFiles(projectItemFiles(loadSampleItems()));
  for (const { path, body } of files) {
    assert.equal(body, readText(join(SAMPLE, path)), `${path}: projected bytes differ`);
  }
  assert.deepEqual(files.map((f) => f.path), [
    "items/0ff73f8ranqzaf0b2n3qpxxzd7.json",
    "items/1jt332depwffcsyfz9txf8c9r9.json",
    "items/1jt332depwffcsyfz9txf8c9r9/v2.json",
    "items/3ev1cjtw7c6q5y8cd0r7aj3bhc.json",
    "items/3wh683yzk9m9byd7tr17fpaxfs.json",
    "items/6y1e4khfxxckyd9dhwgrtv2dj4.json",
    "items/7jbfafqm50v2w8xd9hkxz3yesh.json",
  ]);
});

test("a freshly projected item tree satisfies the shared item-scope checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "blyg-projection-"));
  try {
    writeProjection(dir, serializeFiles(projectItemFiles(loadSampleItems())));
    for (const name of ITEM_SCOPE_CHECKS) {
      assert.doesNotThrow(() => PUB_CHECKS[name]({ dir }), `${name} should pass on the projected tree`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the committed sample surface passes the full shared publication check set", () => {
  const dir = repoPath(SAMPLE);
  for (const [name, check] of Object.entries(PUB_CHECKS)) {
    assert.doesNotThrow(() => check({ dir }), `${name} should pass on the committed sample blyg`);
  }
});

test("the item-scope checks catch a violation (the shared checks really run)", () => {
  const dir = mkdtempSync(join(tmpdir(), "blyg-broken-"));
  try {
    writeProjection(dir, serializeFiles(projectItemFiles(loadSampleItems())));
    const bad = join(dir, "items", "6y1e4khfxxckyd9dhwgrtv2dj4.json");
    const doc = JSON.parse(readFileSync(bad, "utf8"));
    doc.content_hash = "sha256:" + "0".repeat(64);
    writeFileSync(bad, JSON.stringify(doc, null, 2) + "\n");
    assert.throws(() => PUB_CHECKS["hashes-valid"]({ dir }), /content_hash mismatch/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
