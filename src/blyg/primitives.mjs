// Shared wire primitives for the reader import path.
//
// These are the minimal, dependency-free readings of the shared contracts that
// `blyg/reconcile` and its polling importer stand on: identity (§5.1), content
// hashing (§5.1) and origin-scoped identity keys (§12.2, §13.1). They are forward
// implementations of primitives the contract assigns elsewhere — `blyg/ids` and
// `blyg/hash` (SUK-137), `blyg/reference` (SUK-141) — kept tiny and pure so the
// owning modules can replace them without changing reconcile's observable
// behaviour. Nothing here reads network, DOM or private studio state.
export { CROCKFORD, isValidId } from "./ids.mjs";
export { contentHash, sha256Hex } from "./hash.mjs";

const BLYG_KEY_RE = /^[0-9]+\.[0-9]+$/;

/** A protocol version key is any `0.x` value; readers accept them all (spec 3.1). */
export function isValidBlygKey(key) {
  return typeof key === "string" && BLYG_KEY_RE.test(key);
}

/**
 * Normalize an origin for comparison: drop the default port, lowercase
 * scheme/host, and force a trailing slash (spec 12.2, 15.4). Throws on a
 * non-absolute URL so callers can decide how to degrade.
 */
export function normalizeOrigin(origin) {
  const u = new URL(origin);
  const scheme = u.protocol.toLowerCase();
  const host = u.hostname.toLowerCase();
  const port = u.port && u.port !== "80" && u.port !== "443" ? `:${u.port}` : "";
  let path = u.pathname;
  if (!path.endsWith("/")) path += "/";
  return `${scheme}//${host}${port}${path}`;
}

/** Tolerant origin normalizer: falls back to the raw string when it is not a URL. */
export function originKey(origin) {
  if (typeof origin !== "string" || !origin) return "";
  try {
    return normalizeOrigin(origin);
  } catch {
    return origin;
  }
}

/** The origin-scoped identity of an item: `{origin}#{id}` (spec 13.1). */
export function scopedKey(origin, id) {
  return `${originKey(origin)}#${id}`;
}

/** Compare two references by identity members only; `cited`/`selector` are ignored (spec 5.9). */
export function referencesEqual(a, b) {
  if (!a || !b) return false;
  if (a.id !== b.id || Number(a.version) !== Number(b.version)) return false;
  if (a.origin && b.origin) return originKey(a.origin) === originKey(b.origin);
  return !a.origin && !b.origin;
}

/** Direct staleness only: the target doc is newer than the reference (spec 5.9, 10.4). */
export function isStale(reference, targetDoc) {
  return Boolean(
    reference &&
      targetDoc &&
      targetDoc.id === reference.id &&
      Number(targetDoc.version) > Number(reference.version),
  );
}

/**
 * Collapse publisher HTML to a plain-text excerpt for the L0 wrapper (spec 13.6):
 * tags stripped, block boundaries kept as spaces, whitespace collapsed, and
 * truncated at a word boundary up to `max` chars.
 */
export function textExcerpt(html, max = 500) {
  let s = String(html ?? "");
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/blockquote|\/h[1-6])\s*\/?>/gi, " ");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&(#?[a-z0-9]+);/gi, (_, e) => XML_ENTITIES[e.toLowerCase()] ?? `&${e};`);
  s = s.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return (at > 0 ? cut.slice(0, at) : cut).trim() + "\u2026";
}

const XML_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };

/** Escape a string for use in HTML text. */
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Escape a string for use inside a double-quoted HTML attribute. */
export function escapeAttr(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/** Current instant as ISO 8601 UTC (spec 4). */
export function nowIso() {
  return new Date().toISOString();
}
