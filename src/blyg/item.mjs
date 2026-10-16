// blyg/item — §5 the canonical item document, §9 withdrawal, plus the item
// document shapes the publication surface is built from.
//
// Two levels of checking are exposed, matching the two stances in the spec:
//
//   validateItemDocument(doc)  — reader acceptance: exactly what the wire
//     schema accepts, including the ignore-unknown rule (§3, §13.1 rule 4).
//     A reader must accept unknown kinds, unknown members and any author
//     object; it must not reject a document over them.
//
//   validatePublisherItem(doc) — publisher strictness: the reader checks plus
//     the normative publishing rules our own writer must satisfy (`updated`
//     equals the latest changelog `at`, `content_hash` matches `content_md`,
//     the changelog is the version sequence 1..n, an endcap empties what the
//     item said while keeping where it lives and where it came from).
//
// The document builders (`buildItemDocument`, `buildPinnedDocument`) assemble
// output from an explicit allow-list of wire fields only. They never spread an
// internal object, so a private field added to the lifecycle state can never
// leak by default (the fail-closed boundary, §4/§5).

import { isValidId } from "./ids.mjs";
import { contentHash, isContentHash } from "./hash.mjs";
import { isValidMediaEntry } from "./media.mjs";

export const BLYG_VERSION = "0.3";
export const KNOWN_KINDS = Object.freeze(["fragment", "thread", "withdrawn"]);
export const AUTHORED_KINDS = Object.freeze(["fragment", "thread"]);

export function isIso8601Utc(value) {
  return typeof value === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/.test(value);
}

export function isBlygKey(value) {
  return typeof value === "string" && /^[0-9]+\.[0-9]+$/.test(value);
}

export function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function push(errors, path, message) {
  errors.push({ path, message });
}

// ----------------------------------------------------------- shape helpers

export function isCited(value) {
  return isPlainObject(value) && isIso8601Utc(value.retrieved)
    && ["source", "author", "excerpt", "url"].every((key) => value[key] === undefined || typeof value[key] === "string");
}

export function isSelector(value) {
  return isPlainObject(value) && typeof value.exact === "string"
    && ["prefix", "suffix"].every((key) => value[key] === undefined || typeof value[key] === "string");
}

export function isReference(value) {
  return isPlainObject(value) && isValidId(value.id) && isPositiveInteger(value.version)
    && (value.origin === undefined || typeof value.origin === "string")
    && (value.cited === undefined || isCited(value.cited))
    && (value.selector === undefined || isSelector(value.selector));
}

export function isAbsoluteReference(value) {
  return isReference(value) && typeof value.origin === "string";
}

export function isGeneratedSpan(value) {
  if (!isPlainObject(value) || !Array.isArray(value.sources)) return false;
  if (!value.sources.every((s) => isPlainObject(s) && isValidId(s.id) && isPositiveInteger(s.version))) return false;
  if (value.model !== undefined && typeof value.model !== "string") return false;
  if (value.at !== undefined && !isIso8601Utc(value.at)) return false;
  return true;
}

export function isStubOf(value) {
  if (!isPlainObject(value)) return false;
  const web = typeof value.url === "string";
  const blyg = isAbsoluteReference(value);
  return web !== blyg && (value.cited === undefined || isCited(value.cited));
}

// ------------------------------------------------------- document validation

function checkChangelog(changelog, errors, base) {
  if (!Array.isArray(changelog)) {
    push(errors, base, "changelog must be an array");
    return;
  }
  changelog.forEach((entry, i) => {
    const at = `${base}[${i}]`;
    if (!isPlainObject(entry)) return push(errors, at, "changelog entry must be an object");
    if (!isPositiveInteger(entry.version)) push(errors, `${at}.version`, "version must be a positive integer");
    if (!isIso8601Utc(entry.at)) push(errors, `${at}.at`, "at must be an ISO 8601 UTC timestamp");
    if (entry.note !== undefined && entry.note !== null && typeof entry.note !== "string") {
      push(errors, `${at}.note`, "note must be a string or null");
    }
    if (entry.pinned !== undefined && typeof entry.pinned !== "boolean") {
      push(errors, `${at}.pinned`, "pinned must be a boolean");
    }
    if (entry.generated !== undefined && typeof entry.generated !== "boolean") {
      push(errors, `${at}.generated`, "generated must be a boolean");
    }
  });
}

function checkReferences(value, errors, path, { requireOrigin = false } = {}) {
  if (!Array.isArray(value)) return push(errors, path, "must be an array");
  value.forEach((ref, i) => {
    const at = `${path}[${i}]`;
    if (!isReference(ref) || (requireOrigin && !isAbsoluteReference(ref))) {
      push(errors, at, "must be a {origin, id, version} reference (origin required here)");
      return;
    }
    if (ref.selector !== undefined) {
      const sel = ref.selector;
      if (!isPlainObject(sel) || typeof sel.exact !== "string") push(errors, `${at}.selector`, "selector requires a string exact");
    }
    if (ref.cited !== undefined) {
      if (!isPlainObject(ref.cited) || !isIso8601Utc(ref.cited.retrieved)) {
        push(errors, `${at}.cited`, "cited requires an ISO 8601 UTC retrieved");
      }
    }
  });
}

/**
 * Reader-acceptance validation of an item document: the pinned schema's rules,
 * including the ignore-unknown stance. Unknown kinds are accepted; the
 * conditional rules apply only to the known kinds they name.
 * @returns {{ valid: boolean, errors: Array<{path: string, message: string}> }}
 */
export function validateItemDocument(doc) {
  const errors = [];
  if (!isPlainObject(doc)) {
    push(errors, "$", "item document must be an object");
    return { valid: false, errors };
  }
  const required = ["blyg", "id", "kind", "origin", "created", "updated", "version", "content_md", "content_html", "content_hash", "changelog"];
  for (const key of required) {
    if (!(key in doc)) push(errors, `$.${key}`, "required property missing");
  }
  if ("blyg" in doc && !isBlygKey(doc.blyg)) push(errors, "$.blyg", "must be a 0.x version key");
  if ("id" in doc && !isValidId(doc.id)) push(errors, "$.id", "must be 26 lowercase Crockford base32 characters");
  if ("kind" in doc && typeof doc.kind !== "string") push(errors, "$.kind", "must be a string");
  if ("origin" in doc && typeof doc.origin !== "string") push(errors, "$.origin", "must be a string");
  if ("created" in doc && !isIso8601Utc(doc.created)) push(errors, "$.created", "must be an ISO 8601 UTC timestamp");
  if ("updated" in doc && !isIso8601Utc(doc.updated)) push(errors, "$.updated", "must be an ISO 8601 UTC timestamp");
  if ("version" in doc && !isPositiveInteger(doc.version)) push(errors, "$.version", "must be a positive integer");
  if ("content_md" in doc && typeof doc.content_md !== "string") push(errors, "$.content_md", "must be a string");
  if ("content_html" in doc && typeof doc.content_html !== "string") push(errors, "$.content_html", "must be a string");
  if ("content_hash" in doc && !isContentHash(doc.content_hash)) push(errors, "$.content_hash", 'must be "sha256:" + 64 lowercase hex chars');
  if ("page" in doc && typeof doc.page !== "string") push(errors, "$.page", "must be a string");
  if ("author" in doc && !isPlainObject(doc.author)) push(errors, "$.author", "must be a JSON object");
  if ("changelog" in doc) checkChangelog(doc.changelog, errors, "$.changelog");
  if ("media" in doc) {
    if (!Array.isArray(doc.media)) push(errors, "$.media", "must be an array");
    else doc.media.forEach((m, i) => { if (!isValidMediaEntry(m)) push(errors, `$.media[${i}]`, "must be a {url, mime} media entry"); });
  }
  if ("transclusions" in doc) checkReferences(doc.transclusions, errors, "$.transclusions");
  if ("generated" in doc) {
    if (!Array.isArray(doc.generated)) push(errors, "$.generated", "must be an array");
    else doc.generated.forEach((g, i) => { if (!isGeneratedSpan(g)) push(errors, `$.generated[${i}]`, "must be a generated span"); });
  }
  if ("stub_of" in doc && !isStubOf(doc.stub_of)) push(errors, "$.stub_of", "must be a blyg reference (origin required) or a plain-web {url}");
  if ("forked_from" in doc && !isAbsoluteReference(doc.forked_from)) push(errors, "$.forked_from", "must be a reference with origin");

  if (doc.kind === "thread" && !("transclusions" in doc)) {
    push(errors, "$.transclusions", "a thread always carries transclusions (spec 10.3)");
  }
  if (doc.kind === "withdrawn") {
    if (doc.content_md !== "") push(errors, "$.content_md", "a withdrawal endcap empties content_md (spec 9)");
    if (doc.content_html !== "") push(errors, "$.content_html", "a withdrawal endcap empties content_html (spec 9)");
    if ("media" in doc && (!Array.isArray(doc.media) || doc.media.length !== 0)) push(errors, "$.media", "a withdrawal endcap empties media (spec 9)");
    if ("generated" in doc && doc.generated) push(errors, "$.generated", "a withdrawal endcap never carries generated (spec 5.7, 9)");
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Publisher-strictness validation: everything a reader accepts, plus the rules
 * our own writer must never violate. Used as a self-check on projected output.
 */
export function validatePublisherItem(doc) {
  const errors = validateItemDocument(doc).errors.slice();
  if (!isPlainObject(doc) || !Array.isArray(doc.changelog)) return { valid: false, errors };
  const last = doc.changelog[doc.changelog.length - 1];
  if (last && doc.updated !== last.at) push(errors, "$.updated", "must equal the latest changelog entry's at (spec 5.2)");
  if (typeof doc.content_md === "string" && isContentHash(doc.content_hash)) {
    if (doc.content_hash !== contentHash(doc.content_md)) push(errors, "$.content_hash", "must cover content_md (spec 5.1)");
  }
  const expected = doc.changelog.length;
  if (isPositiveInteger(doc.version) && doc.version !== expected) {
    push(errors, "$.version", `version ${doc.version} must equal the changelog length ${expected}`);
  }
  doc.changelog.forEach((entry, i) => {
    if (!isPlainObject(entry) || entry.version !== i + 1) push(errors, `$.changelog[${i}].version`, "changelog versions increment by exactly 1 from 1");
  });
  if (doc.kind === "withdrawn") {
    if ("transclusions" in doc && (!Array.isArray(doc.transclusions) || doc.transclusions.length !== 0)) {
      push(errors, "$.transclusions", "a withdrawn thread's endcap carries [] (spec 9)");
    }
    if ("stub_of" in doc) push(errors, "$.stub_of", "a withdrawal endcap omits stub_of (spec 9)");
  }
  return { valid: errors.length === 0, errors };
}

// -------------------------------------------------- document construction

/**
 * Derive the changelog (publish-event metadata, never content) from the stored
 * version records. `updated` equals the last entry's `at`; pinning adds a
 * `pinned` flag with no new entry; a machine-written note adds `generated`.
 */
export function changelogFromVersions(versions) {
  return versions.map((v) => {
    const entry = { version: v.version, at: v.at, note: v.note ?? null };
    if (v.pinned) entry.pinned = true;
    if (v.noteGenerated) entry.generated = true;
    return entry;
  });
}

function pick(value, keys) {
  const out = {};
  for (const key of Object.keys(value)) if (keys.includes(key) && value[key] !== undefined) out[key] = structuredClone(value[key]);
  return out;
}

export function copyReference(ref) {
  const out = pick(ref, ["id", "version", "origin"]);
  if (ref.cited !== undefined) out.cited = pick(ref.cited, ["source", "author", "excerpt", "url", "retrieved"]);
  if (ref.selector !== undefined) out.selector = pick(ref.selector, ["exact", "prefix", "suffix"]);
  return out;
}

export function copyStubOf(ref) {
  if (typeof ref.url !== "string") return { origin: ref.origin, ...copyReference(ref) };
  const out = { url: ref.url };
  if (ref.cited !== undefined) out.cited = pick(ref.cited, ["source", "author", "excerpt", "url", "retrieved"]);
  return out;
}

function copyGenerated(span) {
  const out = { sources: span.sources.map((source) => pick(source, ["id", "version"])) };
  Object.assign(out, pick(span, ["model", "at"]));
  return out;
}

/**
 * The canonical item document (`items/{id}.json`): the LATEST version's content
 * only, with the full changelog as metadata. Older content is withheld unless a
 * version is pinned (§5.2). Built from an explicit allow-list — never by
 * serializing the internal item state.
 */
export function buildItemDocument(item) {
  const last = item.versions[item.versions.length - 1];
  if (!last) throw new Error("cannot build an item document before the first publish event");
  const doc = {
    blyg: BLYG_VERSION,
    id: item.id,
    kind: last.kind,
    origin: item.origin,
  };
  if (item.page !== undefined) doc.page = item.page;
  if (item.author !== undefined) doc.author = structuredClone(item.author);
  doc.created = item.createdAt;
  doc.updated = last.at;
  doc.version = last.version;
  doc.content_md = last.content_md;
  doc.content_html = last.content_html;
  doc.content_hash = last.content_hash;
  if (last.kind === "withdrawn") {
    doc.media = [];
  } else if (last.media && last.media.length) {
    doc.media = last.media.map((m) => ({ ...m }));
  }
  doc.changelog = changelogFromVersions(item.versions);
  if (last.kind === "thread") doc.transclusions = (last.transclusions ?? []).map(copyReference);
  if (last.kind === "withdrawn" && item.kind === "thread") doc.transclusions = [];
  if (last.stub_of !== undefined) doc.stub_of = copyStubOf(last.stub_of);
  if (item.forkedFrom !== undefined) doc.forked_from = { origin: item.forkedFrom.origin, ...copyReference(item.forkedFrom) };
  if (last.generated !== undefined && last.kind !== "withdrawn") doc.generated = last.generated.map(copyGenerated);
  return doc;
}

/**
 * A pinned version document (`items/{id}/v{n}.json`): the exact bytes promised
 * forever for one version. Pinned documents carry NO `media` array — their
 * `content_html` references media directly, relying on media immutability
 * (§8 rule 4). A pin carries its own citations: `transclusions`, `stub_of`,
 * `forked_from` and `generated` ride along at their published values (§8 rule 5).
 * Withdrawal endcaps are never pinned (spec §8 rule 2).
 */
export function buildPinnedDocument(item, version) {
  const v = findVersion(item, version);
  if (!v || !v.pinned) throw new Error(`unknown version ${version}: no published pin for item ${item.id}`);
  if (v.kind === "withdrawn") throw new Error("a withdrawal endcap cannot be pinned (spec 8 rule 2)");
  const doc = {
    blyg: BLYG_VERSION,
    id: item.id,
    kind: v.kind,
    version: v.version,
    at: v.at,
    note: v.note ?? null,
    pinned: true,
    origin: item.origin,
  };
  if (item.page !== undefined) doc.page = item.page;
  if (item.author !== undefined) doc.author = structuredClone(item.author);
  doc.content_md = v.content_md;
  doc.content_html = v.content_html;
  doc.content_hash = v.content_hash;
  if (v.kind === "thread") doc.transclusions = (v.transclusions ?? []).map(copyReference);
  if (v.stub_of !== undefined) doc.stub_of = copyStubOf(v.stub_of);
  if (item.forkedFrom !== undefined) doc.forked_from = { origin: item.forkedFrom.origin, ...copyReference(item.forkedFrom) };
  if (v.generated !== undefined) doc.generated = v.generated.map(copyGenerated);
  return doc;
}

// ---------------------------------------------------------------- queries

export function findVersion(item, version) {
  return item.versions.find((v) => v.version === version);
}

export function latestVersion(item) {
  return item.versions[item.versions.length - 1];
}

export function pinnedVersions(item) {
  return item.versions.filter((v) => v.pinned);
}

export function isWithdrawn(item) {
  return item.versions.length > 0 && latestVersion(item).kind === "withdrawn";
}

/**
 * The versions a publication may expose: the live version plus pinned
 * versions, and nothing else. Unpinned history is withheld and MUST 404
 * (§5.2, §8.4, R8.4-1).
 */
export function visibleVersions(item) {
  const out = [];
  const last = latestVersion(item);
  if (last) out.push(last);
  for (const v of pinnedVersions(item)) if (v !== last) out.push(v);
  return out;
}

/** Unpinned prior versions: held privately, never routable (§8.4). */
export function hiddenVersions(item) {
  return item.versions.filter((v) => v !== latestVersion(item) && !v.pinned);
}
