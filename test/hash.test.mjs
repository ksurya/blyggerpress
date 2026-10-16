// blyg/hash — §5.1 content_hash, cross-checked against Node's crypto and the
// committed hash vectors.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  sha256Bytes,
  sha256Hex,
  sha256HexOfBytes,
  bytesToHex,
  contentHash,
  isContentHash,
  verifyContentHash,
} from "../src/blyg/hash.mjs";
import { casesWhere } from "./helpers.mjs";

const nodeHex = (data, enc = "utf8") => createHash("sha256").update(data, enc).digest("hex");

const hashVectors = casesWhere((c) => c.check === "vector" && c.module === "blyg/hash");

test("the committed hash vectors are present", () => {
  assert.ok(hashVectors.length >= 2);
});

for (const c of hashVectors) {
  test(`vector ${c.id}`, () => {
    assert.equal(c.fn, "oracle.contentHash");
    assert.equal(contentHash(...(c.args ?? [])), c.expect.result, c.description);
  });
}

test("sha256Hex agrees with Node's crypto over known vectors", () => {
  assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256Hex("hello world"), "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
});

test("sha256Hex agrees with Node's crypto over multibyte and long input", () => {
  const samples = [
    "Björn’s naïve café — 日本語 — 🚀",
    "x".repeat(55), // one byte short of a padding boundary
    "x".repeat(56),
    "x".repeat(64),
    "x".repeat(1000),
    "line one\nline two\r\nline three\ttab",
  ];
  for (const s of samples) assert.equal(sha256Hex(s), nodeHex(s), JSON.stringify(s.slice(0, 20)));
});

test("sha256HexOfBytes agrees with Node's crypto and bytesToHex", () => {
  for (let t = 0; t < 50; t++) {
    const bytes = new Uint8Array(randomBytes(t * 7 + 1));
    assert.equal(sha256HexOfBytes(bytes), nodeHex(bytes));
    assert.equal(bytesToHex(sha256Bytes(bytes)), sha256HexOfBytes(bytes));
  }
});

test("contentHash prefixes the digest and covers content_md only", () => {
  const md = "Markdown source of the *latest* version.";
  assert.equal(contentHash(md), "sha256:" + sha256Hex(md));
  assert.equal(contentHash(""), "sha256:" + sha256Hex(""));
  assert.notEqual(contentHash(md), contentHash(md + " "));
  // Only the content_md string is an input: two documents that differ solely in
  // author, media or content_html share one content_hash (spec 5.1).
  assert.equal(contentHash(md), contentHash(String(md)));
});

test("isContentHash accepts only the canonical shape", () => {
  assert.equal(isContentHash("sha256:" + "a".repeat(64)), true);
  assert.equal(isContentHash("sha256:" + "A".repeat(64)), false);
  assert.equal(isContentHash("sha256:" + "a".repeat(63)), false);
  assert.equal(isContentHash("sha256:not-hex"), false);
  assert.equal(isContentHash("md5:" + "a".repeat(32)), false);
  assert.equal(isContentHash(null), false);
});

test("verifyContentHash detects a hash that does not cover the content", () => {
  const md = "content_md";
  assert.equal(verifyContentHash(md, contentHash(md)), true);
  assert.equal(verifyContentHash(md, contentHash(md + "!")), false);
});
