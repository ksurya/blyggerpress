// blyg/reconcile — reader conformance, the import side (spec §13, plus §3 and §9).
//
// The archive index is the reconciliation surface; the feed is a cheap trigger.
// This module turns fetched, canonical item documents (and the complete archive
// index) into origin-scoped reader state, and does nothing else: it never reads
// network, DOM, or any studio-private state, and every operation is a pure
// store-in / store-out transition so the polling importer can share one import
// state and one failure path across the feed trigger and the index diff.
//
// Load-bearing rules encoded here (each traceable to a requirement id):
//   §13.1  item documents are ground truth; roll up by id (highest version,
//          ties by updated); withdrawal is roll-up-to-null; unknown kinds,
//          members and reserved constructs are ignored, never fatal; ids,
//          authors and trust never cross an origin.
//   §13.2  the feed never mutates state; only a fetched document advances it; a
//          poll failure alters nothing; a missing index degrades to a lossy,
//          feed-window-only subscription.
//   §13.3  a monotonic per-item watermark; a lower version is a loud regression,
//          a same-version hash change is a stealth edit, and a content_hash that
//          disagrees with content_md is a discrepancy — adopted anyway.
//   §13.4  retention follows a pin only; an unpinned withdrawal deletes the copy
//          but remembers the id so a later version is the item returning.
//   §13.6  a synthetic L0 row for legacy RSS: never a valid blyg id, never a
//          transclusion source, a changed GUID is a local version bump.
import { isValidId, contentHash, originKey, scopedKey, textExcerpt, escapeAttr, escapeHtml, nowIso } from "./primitives.mjs";

/** Known item kinds. Everything else is an unknown kind and is ignored (spec 5.3, 13.1 rule 4). */
export const KNOWN_KINDS = Object.freeze(["fragment", "thread", "withdrawn"]);

/** The only discrepancy types the private store commits to (local-store.schema.json, spec 13.3). */
export const DISCREPANCY_TYPES = Object.freeze(["version-regression", "stealth-edit", "hash-mismatch"]);

const clone = (value) => (value == null ? value : structuredClone(value));

// --------------------------------------------------------------------- store

/** Coerce a seed into the private-store shape reconcile operates on. */
export function ensureStore(store) {
  const s = store && typeof store === "object" ? store : {};
  return {
    schemaVersion: s.schemaVersion ?? 1,
    ...s,
    subscriptions: Array.isArray(s.subscriptions) ? s.subscriptions : [],
    imported: Array.isArray(s.imported) ? s.imported : [],
  };
}

function rowKey(row) {
  return scopedKey(row.origin, row.id);
}

/** The stored row for `{origin, id}`, or null (spec 13.1: identity is origin-scoped). */
export function findRow(store, origin, id) {
  const key = scopedKey(origin, id);
  return ensureStore(store).imported.find((r) => rowKey(r) === key) ?? null;
}

function putRow(store, row) {
  const s = ensureStore(store);
  const key = rowKey(row);
  const idx = s.imported.findIndex((r) => rowKey(r) === key);
  const imported = idx === -1 ? [...s.imported, row] : s.imported.map((r, i) => (i === idx ? row : r));
  return { ...s, imported };
}

function makeRow(fields) {
  const row = {
    origin: fields.origin,
    id: fields.id,
    kind: fields.kind,
    version: Math.max(1, Number(fields.version) || 1),
    watermark: Math.max(1, Number(fields.watermark ?? fields.version) || 1),
    observedAt: fields.observedAt ?? nowIso(),
    contentHash: fields.contentHash ?? "",
    contentHtml: fields.contentHtml ?? "",
    contentMd: fields.contentMd ?? null,
    media: Array.isArray(fields.media) ? fields.media : [],
    retainedPinnedVersion: fields.retainedPinnedVersion ?? null,
    l0: fields.l0 === true,
    discrepancies: Array.isArray(fields.discrepancies) ? fields.discrepancies : [],
    // Reconcile-owned extensions (allowed by the private store's additionalProperties).
    withdrawn: fields.withdrawn === true,
    dropped: fields.dropped === true,
    presented: fields.presented !== false,
    pinnedSnapshot: fields.pinnedSnapshot ?? null,
    attribution: fields.attribution ?? null,
    notices: Array.isArray(fields.notices) ? fields.notices : [],
  };
  for (const k of ["updated", "author", "page", "transclusions", "stub_of", "forked_from", "generated"]) {
    if (fields[k] !== undefined) row[k] = fields[k];
  }
  return row;
}

function addDiscrepancy(list, type, at, detail) {
  if (!DISCREPANCY_TYPES.includes(type)) throw new Error(`unknown discrepancy type '${type}'`);
  const base = Array.isArray(list) ? list : [];
  if (base.some((d) => d.type === type && d.detail === detail)) return base;
  return [...base, { type, at, detail }];
}

function addNotice(list, type, at, detail) {
  const base = Array.isArray(list) ? list : [];
  if (base.some((n) => n.type === type && n.detail === detail)) return base;
  return [...base, { type, at, detail }];
}

// ----------------------------------------------------------------- roll-up

/**
 * Roll up rows by origin+id: highest version wins, ties broken by `updated`
 * (spec 13.1 rule 2). Ordering across origins is the reader's own policy (§13.7).
 */
export function rollupById(rows) {
  const winners = new Map();
  for (const r of rows ?? []) {
    if (!r || !r.id) continue;
    const key = rowKey(r);
    const cur = winners.get(key);
    if (!cur || Number(r.version) > Number(cur.version)) winners.set(key, r);
    else if (Number(r.version) === Number(cur.version) && String(r.updated ?? "") > String(cur.updated ?? "")) winners.set(key, r);
  }
  return [...winners.values()];
}

/** The reader's presented surface: withdrawn-unretained copies are dropped (spec 13.4). */
export function observableRows(store) {
  return ensureStore(store).imported.filter((r) => r.presented !== false);
}

/**
 * A row may be a transclusion source iff it is a live blyg item, or a withdrawn
 * item whose retained snapshot follows an origin pin. L0 rows never qualify
 * (spec 13.4, 13.6, 10.2).
 */
export function isTransclusionSource(row) {
  if (!row) return false;
  if (row.l0) return false;
  if (row.kind === "withdrawn") return row.retainedPinnedVersion != null && row.dropped !== true;
  return row.dropped !== true;
}

/** Every origin at which this id has been learned (spec 13.1: ids do not cross origins). */
export function findIdAcrossOrigins(rows, id) {
  return [...new Set((rows ?? []).filter((r) => r.id === id).map((r) => r.origin))];
}

/** A publisher finding one id at two imported origins must treat it as ambiguous (spec 13.1, 5.1). */
export function isAmbiguousAcrossOrigins(rows, id) {
  return findIdAcrossOrigins(rows, id).length > 1;
}

// ------------------------------------------------------- canonical item import

/**
 * Reconcile one fetched canonical item document into the store (§13.1–13.3).
 *
 * `origin` is the FINAL FETCH ORIGIN the document was fetched from — never the
 * document's self-asserted `origin` (spec 12.2). Only this call advances state.
 *
 * @returns {{ store, outcome: string, row?: object }}
 */
export function importCanonicalItem(store, { origin, doc, observedAt = nowIso() } = {}) {
  const st = ensureStore(store);
  const fetchOrigin = originKey(origin) || originKey(doc?.origin);
  if (!doc || typeof doc !== "object") return { store: st, outcome: "ignored-non-document" };
  if (!fetchOrigin) return { store: st, outcome: "ignored-no-origin" };

  const id = doc.id;
  if (!isValidId(id)) return { store: st, outcome: "ignored-invalid-id" };

  const kind = doc.kind;
  // Unknown kinds are unknown constructs: ignore the item, never reject the container.
  if (typeof kind !== "string" || !KNOWN_KINDS.includes(kind)) return { store: st, outcome: "ignored-unknown-kind" };

  const version = Number(doc.version);
  if (!Number.isInteger(version) || version < 1) return { store: st, outcome: "ignored-invalid-version" };

  const existing = findRow(st, fetchOrigin, id);
  const watermark = existing ? Number(existing.watermark) || 0 : 0;

  let notices = existing?.notices ?? [];
  // The document's self-asserted origin is display-advisory; a disagreement with
  // the fetch origin is surfaced but never adopted as identity (spec 12.2).
  const asserted = doc.origin ? originKey(doc.origin) : "";
  if (asserted && asserted !== fetchOrigin) {
    notices = addNotice(notices, "origin-disagreement", observedAt, `document origin ${asserted} != fetch origin ${fetchOrigin}`);
  }

  // §13.3 — history rewriting is loud, never silent.
  if (existing && version < watermark) {
    const row = {
      ...existing,
      observedAt,
      notices,
      discrepancies: addDiscrepancy(existing.discrepancies, "version-regression", observedAt, `fetched v${version} < watermark v${watermark}`),
    };
    return { store: putRow(st, row), outcome: "version-regression", row, discrepancy: "version-regression" };
  }

  if (kind === "withdrawn") {
    return importWithdrawal(st, { fetchOrigin, doc, existing, version, watermark, observedAt, notices });
  }
  return importLive(st, { fetchOrigin, doc, existing, version, watermark, observedAt, notices });
}

function importLive(st, { fetchOrigin, doc, existing, version, watermark, observedAt, notices }) {
  const id = doc.id;
  const discrepancies = existing?.discrepancies ?? [];

  // §13.3 — verify content_hash against content_md; a mismatch is a defect
  // report, not a rejection: the content is adopted anyway.
  let hashMismatch = false;
  if (typeof doc.content_md === "string" && typeof doc.content_hash === "string") {
    if (contentHash(doc.content_md) !== doc.content_hash) {
      hashMismatch = true;
    }
  }

  // §13.3 — same version, different hash is a stealth edit: adopt, record, and
  // leave the watermark unchanged.
  const stealth = Boolean(
    existing &&
      version === Number(existing.version) &&
      existing.contentHash &&
      typeof doc.content_hash === "string" &&
      doc.content_hash !== existing.contentHash,
  );

  // §13.1 rule 2 — a same-version, same-content observation that is older than
  // the stored one loses the tie by `updated`; nothing changes.
  if (
    existing &&
      version === Number(existing.version) &&
      !stealth &&
      !hashMismatch &&
      typeof doc.updated === "string" &&
      typeof existing.updated === "string" &&
      doc.updated < existing.updated
  ) {
    return { store: putRow(st, { ...existing, observedAt, notices }), outcome: "unchanged", row: existing };
  }

  if (hashMismatch) {
    const actual = contentHash(doc.content_md);
    return finalizeLive(st, {
      fetchOrigin, doc, existing, version, watermark, observedAt, notices,
      discrepancies: addDiscrepancy(discrepancies, "hash-mismatch", observedAt, `content_hash ${doc.content_hash} != ${actual}`),
      outcome: "hash-mismatch",
    });
  }

  if (stealth) {
    return finalizeLive(st, {
      fetchOrigin, doc, existing, version, watermark, observedAt, notices,
      discrepancies: addDiscrepancy(discrepancies, "stealth-edit", observedAt, `v${version} content_hash changed without a version bump`),
      outcome: "stealth-edit",
    });
  }

  return finalizeLive(st, {
    fetchOrigin, doc, existing, version, watermark, observedAt, notices, discrepancies,
    outcome: version > watermark ? "adopted" : "adopted-same-version",
  });
}

function finalizeLive(st, { fetchOrigin, doc, existing, version, watermark, observedAt, notices, discrepancies, outcome }) {
  const row = makeRow({
    origin: existing?.origin ?? fetchOrigin,
    id: doc.id,
    kind: doc.kind,
    version,
    updated: doc.updated ?? existing?.updated,
    contentHash: doc.content_hash ?? "",
    contentHtml: doc.content_html ?? "",
    contentMd: typeof doc.content_md === "string" ? doc.content_md : null,
    author: doc.author !== undefined ? clone(doc.author) : existing?.author,
    page: doc.page ?? existing?.page,
    media: Array.isArray(doc.media) ? doc.media : [],
    retainedPinnedVersion: existing?.retainedPinnedVersion ?? null,
    l0: false,
    watermark: Math.max(watermark, version),
    observedAt,
    discrepancies,
    notices,
    withdrawn: false,
    dropped: false,
    presented: true,
    pinnedSnapshot: existing?.pinnedSnapshot ?? null,
    ...Object.fromEntries(["transclusions", "stub_of", "forked_from", "generated"]
      .filter(k => doc[k] !== undefined).map(k => [k, clone(doc[k])])),
  });
  return { store: putRow(st, row), outcome, row };
}

function importWithdrawal(st, { fetchOrigin, doc, existing, version, watermark, observedAt, notices }) {
  const newWatermark = Math.max(watermark, version);
  const pinnedVersion = existing?.retainedPinnedVersion ?? null;
  const discrepancies = existing?.discrepancies ?? [];

  // §13.4 — retention follows a pin: the origin still serves those exact bytes,
  // so the snapshot is retained with attribution and stays a valid source.
  if (pinnedVersion != null) {
    const snap =
      existing.pinnedSnapshot ?? {
        version: existing.version,
        contentHash: existing.contentHash,
        contentHtml: existing.contentHtml,
        contentMd: existing.contentMd,
        page: existing.page,
      };
    const row = makeRow({
      origin: fetchOrigin,
      id: doc.id,
      kind: "withdrawn",
      version: newWatermark,
      updated: doc.updated ?? existing.updated,
      contentHash: snap.contentHash,
      contentHtml: snap.contentHtml,
      contentMd: snap.contentMd ?? null,
      author: snap.author ?? existing.author,
      ...Object.fromEntries(["transclusions", "stub_of", "forked_from", "generated"]
        .filter(k => snap[k] !== undefined).map(k => [k, clone(snap[k])])),
      page: snap.page ?? existing.page,
      media: [],
      retainedPinnedVersion: pinnedVersion,
      l0: false,
      watermark: newWatermark,
      observedAt,
      discrepancies,
      notices,
      withdrawn: true,
      dropped: false,
      presented: true,
      pinnedSnapshot: snap,
      attribution: { origin: fetchOrigin, id: doc.id, version: pinnedVersion, retained: true },
    });
    return { store: putRow(st, row), outcome: "withdrawn-retained", row };
  }

  // §13.4 — everything unpinned rolls to null: stop presenting, delete the copy,
  // but remember the id so a later version is the item returning (spec 9).
  const row = makeRow({
    origin: fetchOrigin,
    id: doc.id,
    kind: "withdrawn",
    version: newWatermark,
    updated: doc.updated ?? existing?.updated,
    contentHash: "",
    contentHtml: "",
    contentMd: null,
    author: doc.author !== undefined ? clone(doc.author) : existing?.author,
    page: doc.page ?? existing?.page,
    media: [],
    retainedPinnedVersion: null,
    l0: false,
    watermark: newWatermark,
    observedAt,
    discrepancies,
    notices,
    withdrawn: true,
    dropped: true,
    presented: false,
  });
  return { store: putRow(st, row), outcome: "withdrawn-dropped", row };
}

/**
 * Record that a pinned version is locally retained (spec 8, 13.4). Retention is
 * the reader's one durable-citation instrument and the only thing that may
 * outlive a withdrawal. Returns the updated store and the row.
 */
export function retainPinnedVersion(store, { origin, id, version, snapshot = {}, observedAt = nowIso() } = {}) {
  const st = ensureStore(store);
  const fetchOrigin = originKey(origin) || originKey(snapshot.origin);
  if (!isValidId(id) || !fetchOrigin) return { store: st, outcome: "ignored-invalid" };
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) return { store: st, outcome: "ignored-invalid-version" };

  const existing = findRow(st, fetchOrigin, id);
  const snap = {
    version: v,
    contentHash: snapshot.contentHash ?? snapshot.content_hash ?? "",
    contentHtml: snapshot.contentHtml ?? snapshot.content_html ?? "",
    contentMd: snapshot.contentMd ?? snapshot.content_md ?? null,
    page: snapshot.page ?? existing?.page,
    ...Object.fromEntries(["kind", "author", "transclusions", "stub_of", "forked_from", "generated"]
      .filter(k => snapshot[k] !== undefined).map(k => [k, clone(snapshot[k])])),
  };

  const row = existing
    ? { ...existing, retainedPinnedVersion: v, pinnedSnapshot: snap, observedAt }
    : makeRow({
        origin: fetchOrigin,
        id,
        kind: snapshot.kind ?? "fragment",
        version: v,
        updated: snapshot.updated ?? observedAt,
        contentHash: snap.contentHash,
        contentHtml: snap.contentHtml,
        contentMd: snap.contentMd,
        author: snapshot.author !== undefined ? clone(snapshot.author) : undefined,
        page: snap.page,
        media: [],
        retainedPinnedVersion: v,
        l0: false,
        watermark: v,
        observedAt,
        discrepancies: [],
        withdrawn: false,
        dropped: false,
        presented: true,
        pinnedSnapshot: snap,
      });
  return { store: putRow(st, row), outcome: "pin-retained", row };
}

// --------------------------------------------------- archive-index reconcile

/** Parse and shape-check `items/index.json` (spec 6.2). Throws on a non-index. */
export function parseArchiveIndex(text) {
  const obj = typeof text === "string" ? JSON.parse(text) : text;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.items)) throw new Error("invalid archive index");
  return obj;
}

function needsFetch(existing, summary) {
  if (!existing) return true;
  const wm = Number(existing.watermark) || 0;
  const sv = Number(summary.version) || 0;
  if (sv > wm) return true;
  // A same-version kind change is a withdrawal or a return (spec 9, 13.4).
  if (sv === wm && typeof summary.kind === "string" && summary.kind !== existing.kind) return true;
  return false;
}

/**
 * Diff the complete archive index against local watermarks and fetch only the
 * documents that are missing or newer (spec 13.2). The index is the
 * reconciliation surface, so this is total recovery regardless of any feed
 * window. A missing or malformed index is nonconforming: the caller marks the
 * subscription lossy and falls back to feed-window-only operation.
 *
 * `fetchItem(id, summary)` returns the parsed canonical document or null on
 * 404. A single item failure is isolated and never aborts the diff, and a
 * failure never mutates stored state.
 *
 * @returns {Promise<{ store, lossy: boolean, fetched: object[], skipped: object[], failures: object[] }>}
 */
export async function reconcileIndex(store, { origin, index, fetchItem, observedAt = nowIso() } = {}) {
  const st = ensureStore(store);
  const fetchOrigin = originKey(origin);
  if (!index || typeof index !== "object" || !Array.isArray(index.items) || !fetchOrigin) {
    return { store: st, lossy: true, reason: "index-unavailable", fetched: [], skipped: [], failures: [] };
  }

  let next = st;
  const fetched = [];
  const skipped = [];
  const failures = [];

  for (const summary of index.items) {
    if (!summary || typeof summary !== "object" || !isValidId(summary.id)) {
      skipped.push({ id: summary?.id, reason: "invalid-id" });
      continue;
    }
    if (typeof summary.kind === "string" && !KNOWN_KINDS.includes(summary.kind)) {
      // Unknown kinds are ignored, not fetched (spec 5.3, 13.1 rule 4).
      skipped.push({ id: summary.id, reason: "unknown-kind" });
      continue;
    }
    const existing = findRow(next, fetchOrigin, summary.id);
    if (!needsFetch(existing, summary)) {
      skipped.push({ id: summary.id, reason: "up-to-date" });
      continue;
    }

    let doc = null;
    try {
      doc = await fetchItem?.(summary.id, summary);
    } catch (error) {
      failures.push({ id: summary.id, reason: "fetch-failed", error: String(error?.message ?? error) });
      continue;
    }
    if (!doc) {
      failures.push({ id: summary.id, reason: "not-found" });
      continue;
    }
    const res = importCanonicalItem(next, { origin: fetchOrigin, doc, observedAt });
    next = res.store;
    fetched.push({ id: summary.id, outcome: res.outcome });
  }

  return { store: next, lossy: false, fetched, skipped, failures };
}

// ----------------------------------------------------------- feed trigger

function entryIdentity(entry) {
  if (!entry || typeof entry !== "object") return null;
  let id = entry.id;
  let version = entry.version;
  if ((!id || version === undefined) && typeof entry.guid === "string") {
    const m = /^blyg:([0-9abcdefghjkmnpqrstvwxyz]{26}):v(\d+)$/.exec(entry.guid);
    if (m) {
      id ??= m[1];
      version ??= Number(m[2]);
    }
  }
  if (!isValidId(id)) return null;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) return null;
  return { id, version: v, kind: typeof entry.kind === "string" ? entry.kind : undefined };
}

/**
 * The feed's only job: cheap change detection. This returns the item documents
 * worth fetching, and never mutates state — an interesting entry, including a
 * withdrawal entry, still triggers a fetch, and only that fetched document
 * advances state (spec 13.2).
 */
export function feedTriggers(store, { origin, feedModel } = {}) {
  const st = ensureStore(store);
  const fetchOrigin = originKey(origin);
  const byId = new Map();
  for (const entry of feedModel?.entries ?? []) {
    const identity = entryIdentity(entry);
    if (!identity || !fetchOrigin) continue;
    const existing = findRow(st, fetchOrigin, identity.id);
    const wm = existing ? Number(existing.watermark) || 0 : 0;
    const reasons = [];
    if (!existing) reasons.push("unseen");
    else if (identity.version > wm) reasons.push("newer");
    else if (identity.version === wm && identity.kind && identity.kind !== existing.kind) {
      reasons.push(identity.kind === "withdrawn" ? "withdrawal" : "return");
    }
    if (!reasons.length) continue;
    const candidate = {
      id: identity.id,
      version: identity.version,
      kind: identity.kind,
      itemUrl: entry.itemUrl ?? null,
      link: entry.link ?? null,
      reason: reasons.join("+"),
    };
    const cur = byId.get(identity.id);
    if (!cur || candidate.version > cur.version) byId.set(identity.id, candidate);
  }
  return [...byId.values()];
}

/**
 * A suspected feed-window gap: the previously newest-seen entry is gone from the
 * window, or there is no recorded head yet. Either way the caller falls back to
 * an index diff, which recovers everything (spec 13.2).
 */
export function detectFeedGap(previousHead, feedModel) {
  const guids = (feedModel?.entries ?? []).map((e) => e?.guid).filter(Boolean);
  if (!guids.length) return false;
  if (!previousHead) return true;
  return !guids.includes(previousHead);
}

// --------------------------------------------------------- legacy L0 wrapper

/**
 * Deterministic synthetic id for an L0 row, derived from the entry's GUID (or
 * link, absent a GUID). The `l0-` prefix guarantees it is never a valid blyg id
 * (spec 13.6). Uses a local FNV-style digest so the module stays dependency-light.
 */
export function syntheticL0Id(guidOrLink) {
  return `l0-${l0Digest(String(guidOrLink ?? ""))}`;
}

function l0Digest(input) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 24);
}

/**
 * Wrap one plain-RSS entry as an origin-scoped L0 row (spec 13.6). These rows
 * are best-effort by design: synthetic ids are never valid blyg ids and are
 * never exported; content is the entry title linking to the entry URL plus a
 * sanitized, truncated summary; and because RSS has no versions, the same GUID
 * reappearing with changed content is a local version bump. There is no
 * withdrawal and no archive index.
 */
export function wrapLegacyEntry(store, { origin, entry, observedAt = nowIso(), maxExcerpt = 500 } = {}) {
  const st = ensureStore(store);
  const fetchOrigin = originKey(origin) || String(origin ?? "");
  const identity = entry?.guid || entry?.link || entry?.title;
  if (!fetchOrigin || !identity) return { store: st, outcome: "ignored-no-identity" };

  const id = syntheticL0Id(identity);
  const existing = findRow(st, fetchOrigin, id);
  const title = String(entry.title ?? "");
  const summaryText = textExcerpt(entry.descriptionHtml ?? entry.summaryHtml ?? "", maxExcerpt);
  const link = String(entry.link ?? "");
  const contentHtml = link
    ? `<p><a href="${escapeAttr(link)}">${escapeHtml(title)}</a></p>${summaryText ? `<p>${escapeHtml(summaryText)}</p>` : ""}`
    : `<p>${escapeHtml(title)}</p>${summaryText ? `<p>${escapeHtml(summaryText)}</p>` : ""}`;
  const hash = contentHash(contentHtml);
  const changed = Boolean(existing && existing.contentHash && existing.contentHash !== hash);

  const version = existing ? (changed ? Number(existing.version) + 1 : Number(existing.version)) : 1;
  const row = makeRow({
    origin: existing?.origin ?? fetchOrigin,
    id,
    kind: "fragment",
    version,
    updated: entry.pubDate ?? observedAt,
    contentHash: hash,
    contentHtml,
    contentMd: [title, summaryText].filter(Boolean).join("\n\n"),
    author: entry.creator ? { name: String(entry.creator) } : existing?.author,
    page: link || existing?.page,
    media: [],
    retainedPinnedVersion: null,
    l0: true,
    watermark: Math.max(existing ? Number(existing.watermark) || 0 : 0, version),
    observedAt,
    discrepancies: existing?.discrepancies ?? [],
    notices: existing?.notices ?? [],
    withdrawn: false,
    dropped: false,
    presented: true,
  });

  const outcome = !existing ? "l0-wrapped" : changed ? "l0-bumped" : "l0-unchanged";
  return { store: putRow(st, row), outcome, row };
}
