// blyg/ids — §5.1 identity.
//
// An `id` is 128 random bits encoded as 26 lowercase Crockford base32
// characters (alphabet 0123456789abcdefghjkmnpqrstvwxyz, no padding),
// generated from a cryptographically strong source. Ids are permanent
// identity: they never change across versions, withdrawal, or return
// (§5.1, R5.1-1, R5.1-2).
//
// Runtime-agnostic and dependency-free: randomness comes from the platform's
// Web Crypto CSPRNG (globalThis.crypto.getRandomValues), which exists in
// browsers and in Node.js >= 20, so the same module serves the static studio
// and the Node tooling.

export const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
export const ID_LENGTH = 26;
export const ID_BYTES = 16;

// The canonical alphabet deliberately excludes i, l, o and u.
const ID_RE = /^[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

/** Reader-acceptance test for an id (spec 5.1). Does not decode. */
export function isValidId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

/**
 * Encode exactly 16 bytes (128 bits) as 26 lowercase Crockford base32 chars.
 * Big-endian: the most significant bit of the 130-bit field is the first
 * character's high bit, so a full-entropy draw always begins with <= '7'.
 */
export function encodeId(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== ID_BYTES) {
    throw new Error(`encodeId expects exactly ${ID_BYTES} bytes`);
  }
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const out = [];
  for (let i = 0; i < ID_LENGTH; i++) {
    out.push(CROCKFORD[Number(n & 31n)]);
    n >>= 5n;
  }
  return out.reverse().join("");
}

/** Decode a canonical 26-char id back to its 16 bytes. Rejects non-canonical chars. */
export function decodeId(id) {
  if (typeof id !== "string" || id.length !== ID_LENGTH) {
    throw new Error(`id must be ${ID_LENGTH} characters`);
  }
  let n = 0n;
  for (const ch of id) {
    const d = CROCKFORD.indexOf(ch);
    if (d < 0) throw new Error(`non-canonical base32 character: ${ch}`);
    n = (n << 5n) | BigInt(d);
  }
  n &= (1n << 128n) - 1n;
  const bytes = new Uint8Array(ID_BYTES);
  for (let i = ID_BYTES - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

/**
 * Draw n cryptographically strong random bytes from the platform CSPRNG.
 * Never falls back to Math.random: an id with weak entropy would not be a
 * usable identity, so a missing CSPRNG is a hard error (spec 5.1).
 */
export function secureRandomBytes(n) {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("no cryptographically strong random source (crypto.getRandomValues unavailable)");
  }
  const bytes = new Uint8Array(n);
  c.getRandomValues(bytes);
  return bytes;
}

/** Generate a fresh, valid id (§5.1, R5.1-1). */
export function newId() {
  return encodeId(secureRandomBytes(ID_BYTES));
}

/** Hex-string conveniences, kept for fixture parity with the oracle. */
export function encodeIdHex(hex) {
  if (typeof hex !== "string" || hex.length !== ID_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error("encodeIdHex expects 32 hex characters");
  }
  const bytes = new Uint8Array(ID_BYTES);
  for (let i = 0; i < ID_BYTES; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return encodeId(bytes);
}

export function decodeIdHex(id) {
  return Array.from(decodeId(id))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
