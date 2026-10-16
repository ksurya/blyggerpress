// Non-normative reference oracle used ONLY to generate and check conformance
// fixtures for the pure, deterministic primitives of Blygger 0.3. It is not a
// product module and carries no DOM. Implementation issues (SUK-137+) own the
// real modules; their tests are checked against the committed fixtures, which
// this oracle keeps self-consistent.
import { createHash, randomBytes } from "node:crypto";

export const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";

/** Encode 16 bytes (128 bits) as 26 lowercase Crockford base32 chars (spec 5.1). */
export function crockfordEncode(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new Error("crockfordEncode expects exactly 16 bytes");
  }
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  const out = [];
  for (let i = 0; i < 26; i++) {
    out.push(CROCKFORD[Number(n & 31n)]);
    n >>= 5n;
  }
  return out.reverse().join("");
}

/** Decode a 26-char canonical id back to 16 bytes. Rejects non-canonical chars (spec 5.1). */
export function crockfordDecode(id) {
  if (typeof id !== "string" || id.length !== 26) throw new Error("id must be 26 chars");
  let n = 0n;
  for (const ch of id) {
    const d = CROCKFORD.indexOf(ch);
    if (d < 0) throw new Error(`non-canonical base32 char: ${ch}`);
    n = (n << 5n) | BigInt(d);
  }
  n &= (1n << 128n) - 1n;
  const bytes = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

export function isValidId(id) {
  return typeof id === "string" && /^[0-9abcdefghjkmnpqrstvwxyz]{26}$/.test(id);
}

export function newId() {
  return crockfordEncode(randomBytes(16));
}

/** Hex-string conveniences for fixture vectors. */
export function crockfordEncodeHex(hex) {
  const bytes = new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
  return crockfordEncode(bytes);
}

export function crockfordDecodeHex(id) {
  return Array.from(crockfordDecode(id)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** content_hash = "sha256:" + hex(SHA-256(content_md as UTF-8)) (spec 5.1). */
export function contentHash(contentMd) {
  return "sha256:" + sha256Hex(contentMd);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Format an ISO 8601 UTC instant as RFC 822 (spec 4, 7). */
export function rfc822(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("invalid ISO instant");
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${DAYS[d.getUTCDay()]}, ${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ` +
    `${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`
  );
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

/**
 * Text content of content_html: tags stripped, whitespace collapsed within a
 * block, block boundaries kept as line breaks (spec 2, 10.2).
 */
export function textContent(html) {
  let s = String(html);
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/blockquote|\/h[1-6]|\/tr|\/table|\/section|\/article)[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s.replace(/&(#?[a-z0-9]+);/gi, (_, e) => ENTITIES[e.toLowerCase()] ?? `&${e};`);
  s = s
    .split("\n")
    .map((line) => line.replace(/[ \t\r\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n");
  return s.trim();
}

/** Partial-transclusion faithfulness: is the normalized selection a substring of the text content (spec 10.2)? */
export function selectionIsSubstring(selection, targetHtml) {
  const norm = (t) => String(t).replace(/[ \t\r\f\v]+/g, " ").trim();
  return textContent(targetHtml).includes(norm(selection));
}

/** RFC 6570 level-1 template expansion: `{var}` only (spec 16.6e, used for 0.4 room). */
export function rfc6570Expand(template, vars) {
  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (_, name) => {
    if (!(name in vars)) throw new Error(`missing template variable: ${name}`);
    return encodeURIComponent(String(vars[name]));
  });
}

/** Normalize an origin for comparison: drop default port, case-insensitive scheme/host, ensure trailing slash (spec 12.2, 15.4). */
export function normalizeOrigin(origin) {
  const u = new URL(origin);
  const scheme = u.protocol.toLowerCase();
  const host = u.hostname.toLowerCase();
  const port = u.port && u.port !== "80" && u.port !== "443" ? `:${u.port}` : "";
  let path = u.pathname;
  if (!path.endsWith("/")) path += "/";
  return `${scheme}//${host}${port}${path}`;
}

/** Compare two references by their identity members only; cited/selector are ignored (spec 5.9, 15.4). */
export function referencesEqual(a, b) {
  return a.id === b.id && a.version === b.version && normalizeOrigin(a.origin) === normalizeOrigin(b.origin);
}

/** Direct staleness: a reference is stale when the target document's version is higher (spec 5.9, 10.4). */
export function isStale(reference, targetDoc) {
  return targetDoc.id === reference.id && targetDoc.version > reference.version;
}

/** Expected feed `<title>` derivation: `note — excerpt`, or excerpt alone; withdrawn is literal (spec 7). */
export function deriveFeedTitle(note, excerpt, kind) {
  if (kind === "withdrawn") return "withdrawn";
  return note ? `${note} \u2014 ${excerpt}` : excerpt;
}

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}
