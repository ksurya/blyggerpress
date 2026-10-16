// blyg/ids — §5.1 identity, checked against the committed id vectors.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CROCKFORD,
  ID_LENGTH,
  ID_BYTES,
  isValidId,
  encodeId,
  decodeId,
  encodeIdHex,
  decodeIdHex,
  secureRandomBytes,
  newId,
} from "../src/blyg/ids.mjs";
import { casesWhere } from "./helpers.mjs";

// Every id vector in the fixture suite runs against the implementation's own
// functions (the vectors name the oracle; the mapping is the whole point).
const VECTOR_FN = {
  "oracle.crockfordEncodeHex": encodeIdHex,
  "oracle.crockfordDecodeHex": decodeIdHex,
  "oracle.isValidId": isValidId,
};

const idVectors = casesWhere((c) => c.check === "vector" && c.module === "blyg/ids");

test("the committed id vectors are present and all exercised", () => {
  assert.ok(idVectors.length >= 5, "expected the id vector family");
  for (const c of idVectors) assert.ok(VECTOR_FN[c.fn], `no implementation mapping for ${c.fn}`);
});

for (const c of idVectors) {
  test(`vector ${c.id}`, () => {
    const fn = VECTOR_FN[c.fn];
    const result = fn(...(c.args ?? []));
    assert.deepEqual(result, c.expect.result, c.description);
  });
}

test("R5.1-1: the alphabet excludes i, l, o and u", () => {
  assert.equal(CROCKFORD, "0123456789abcdefghjkmnpqrstvwxyz");
  assert.equal(ID_LENGTH, 26);
  assert.equal(ID_BYTES, 16);
  for (const ch of "ilou") assert.ok(!CROCKFORD.includes(ch));
});

test("R5.1-1: encodeId/decodeId round-trip every byte pattern", () => {
  for (let t = 0; t < 200; t++) {
    const bytes = secureRandomBytes(ID_BYTES);
    const id = encodeId(bytes);
    assert.ok(isValidId(id), `${id} should be a valid id`);
    assert.deepEqual([...decodeId(id)], [...bytes], "bytes must survive the round trip");
    assert.equal(encodeId(decodeId(id)), id, "re-encoding a decoded id is the identity");
  }
});

test("R5.1-1: a full-entropy draw begins within the first 3 bits' alphabet", () => {
  // 128 bits into 26*5=130 bits leaves the top 2 bits zero, so the first char
  // is always <= '7' (its high bits are unused).
  for (let t = 0; t < 50; t++) {
    const id = newId();
    assert.ok("01234567".includes(id[0]), `first char ${id[0]} should be within 0-7`);
  }
});

test("R5.1-1: ids are drawn from a CSPRNG and do not collide", () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const id = newId();
    assert.ok(isValidId(id));
    assert.ok(!seen.has(id), "a fresh 128-bit id must not repeat");
    seen.add(id);
  }
});

test("decodeId rejects non-canonical input", () => {
  const valid = "1jt332depwffcsyfz9txf8c9r9";
  assert.equal(valid.length, 26);
  assert.throws(() => decodeId(valid.slice(0, 25) + "i"), /non-canonical/);
  assert.throws(() => decodeId(valid.slice(0, 25) + "U"), /non-canonical/);
  assert.throws(() => decodeId("tooshort"), /26 characters/);
  assert.throws(() => decodeId(valid + "9"), /26 characters/);
});

test("encoders reject malformed input", () => {
  assert.throws(() => encodeId(new Uint8Array(15)), /exactly 16 bytes/);
  assert.throws(() => encodeIdHex("zz"), /32 hex/);
  assert.throws(() => encodeIdHex("00"), /32 hex/);
});

test("secureRandomBytes returns the requested length", () => {
  assert.equal(secureRandomBytes(0).length, 0);
  assert.equal(secureRandomBytes(7).length, 7);
  assert.equal(secureRandomBytes(32).length, 32);
});

test("isValidId is a pure shape test (no decoding)", () => {
  assert.equal(isValidId("00000000000000000000000000"), true);
  assert.equal(isValidId("7zzzzzzzzzzzzzzzzzzzzzzzzz"), true);
  assert.equal(isValidId(""), false);
  assert.equal(isValidId("1jt332depwffcsyfz9txf8c9r9A"), false);
  assert.equal(isValidId(123), false);
});
