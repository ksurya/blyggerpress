// blyg/hash — §5.1 `content_hash`.
//
// content_hash MUST be "sha256:" + hex(SHA-256(content_md as UTF-8)),
// covering `content_md` only — not `author`, not media bytes, not
// `content_html` (spec 5.1, R5.1-3).
//
// A small, dependency-free, synchronous SHA-256 is implemented here so the
// module works untouched in the browser-shipped studio and in Node tooling.
// It is checked against Node's crypto in the test suite.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

const utf8 = (text) => new TextEncoder().encode(String(text));

/**
 * SHA-256 over raw bytes. Returns the 32-byte digest.
 * @param {Uint8Array} input
 * @returns {Uint8Array}
 */
export function sha256Bytes(input) {
  const msg = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bitLen = msg.length * 8;
  // Pad: 0x80, zeros, then the 64-bit big-endian bit length, to a 64-byte block.
  const padded = (((msg.length + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(padded);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padded - 8, Math.floor(bitLen / 0x100000000), false);
  dv.setUint32(padded - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((v, i) => odv.setUint32(i * 4, v, false));
  return out;
}

export function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** hex(SHA-256(utf8(text))). */
export function sha256Hex(text) {
  return bytesToHex(sha256Bytes(utf8(text)));
}

/** hex(SHA-256(bytes)) — used for media immutability. */
export function sha256HexOfBytes(bytes) {
  return bytesToHex(sha256Bytes(bytes));
}

/** content_hash = "sha256:" + hex(SHA-256(content_md as UTF-8)) (spec 5.1). */
export function contentHash(contentMd) {
  if (typeof contentMd !== "string") throw new Error("contentHash expects a string content_md");
  return "sha256:" + sha256Hex(contentMd);
}

/** Reader-acceptance test for a content_hash value (spec 5.1). */
export function isContentHash(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

/** Does the hash actually cover this content_md? (spec 5.1, 13.3 rule 3). */
export function verifyContentHash(contentMd, contentHashValue) {
  return contentHash(contentMd) === contentHashValue;
}
