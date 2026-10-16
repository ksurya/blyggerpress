// blyg/publication — the item-facing projection of an item set: publish events,
// archive rows, and the item documents a static export writes to disk.
//
// This module is the seam between SUK-137 (the item publication lifecycle) and
// SUK-138 (the full publication surface: manifest, feed, archive index, pins,
// static export). SUK-137 owns what an item *is* and how it is published; this
// module turns published items into the two things every other surface is built
// from:
//
//   * publish events — one per version, newest first, with a withdrawal
//     collapsing the item to its single endcap event (spec 7, R7-2, R7-7), and
//     pinning emitting nothing (R7-8, spec 8).
//
//   * item files — `items/{id}.json` and the pinned `items/{id}/v{n}.json`
//     documents, assembled only through the allow-listed builders in blyg/item.
//
// SUK-138 wires these into `blyg.json`, `feed.xml`, `items/index.json` and the
// HTML pages; nothing here writes the full surface, and nothing here depends on
// the feed or the manifest.

import { buildItemDocument, buildPinnedDocument, latestVersion, pinnedVersions, isWithdrawn } from "./item.mjs";
import { pinnedMediaUrls } from "./media.mjs";

/**
 * The publish events an item contributes, newest first. One per version; a
 * withdrawn item contributes exactly one (its endcap) and its earlier events
 * drop out of the surface (spec 7, R7-7). Pinning is not a publish event and
 * never appears here (spec 8, R7-8).
 *
 * @returns {Array<{id:string,version:number,at:string,note:string|null,generated:boolean,kind:string,pinned:boolean}>}
 */
export function publishEvents(item) {
  if (isWithdrawn(item)) {
    const v = latestVersion(item);
    return [{ id: item.id, version: v.version, at: v.at, note: v.note ?? null, generated: false, kind: "withdrawn", pinned: false }];
  }
  return item.versions
    .slice()
    .reverse()
    .map((v) => ({
      id: item.id,
      version: v.version,
      at: v.at,
      note: v.note ?? null,
      generated: Boolean(v.noteGenerated),
      kind: v.kind,
      pinned: Boolean(v.pinned),
    }));
}

/** Total publish events across a set of items (the feed window's raw count). */
export function publishEventCount(item) {
  return isWithdrawn(item) ? 1 : item.versions.length;
}

/** One archive-index row for an item (spec 6.2, ItemSummary). */
export function archiveRow(item) {
  return {
    id: item.id,
    kind: latestVersion(item).kind,
    created: item.createdAt,
    updated: latestVersion(item).at,
    version: latestVersion(item).version,
  };
}

/**
 * Archive rows for every item ever published, ordered by `updated` descending
 * (spec 6.2). This is the input SUK-138's `items/index.json` assembles; the
 * index being windowless and including withdrawn items is enforced there.
 */
export function archiveRows(items) {
  return items
    .map(archiveRow)
    .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated) || a.id.localeCompare(b.id));
}

/**
 * The item documents one item publishes: its canonical document plus one pinned
 * version document per pin. Only the latest version's content is served; older
 * content appears solely as pinned documents (spec 5.2, 8.4).
 *
 * @returns {Array<{path:string, value:object}>}
 */
export function itemFiles(item) {
  const files = [{ path: `items/${item.id}.json`, value: buildItemDocument(item) }];
  for (const v of pinnedVersions(item)) {
    files.push({ path: `items/${item.id}/v${v.version}.json`, value: buildPinnedDocument(item, v.version) });
  }
  return files;
}

/** The item documents for a whole item set, path-sorted. */
export function projectItemFiles(items) {
  return items
    .flatMap(itemFiles)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Canonical JSON text for one projected document (2-space indent, trailing newline). */
export function serialize(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

/** `{ path, body }` pairs ready to be written as static files. */
export function serializeFiles(files) {
  return files.map(({ path, value }) => ({ path, body: serialize(value) }));
}

/** The media URLs a publication must retain forever: those on pinned versions (spec 8 rule 4). */
export function retainedMediaUrls(items) {
  const out = new Set();
  for (const item of items) for (const url of pinnedMediaUrls(item)) out.add(url);
  return [...out].sort();
}

/**
 * Fail-closed privacy guard: throw if any forbidden private token — draft text,
 * instruction text, reader-local bookkeeping — appears in the projected
 * publication text (spec 4, 13.5; R5.7-2, R13.5-1). The projection's allow-list
 * builders should make this always pass; the guard exists so a leak is loud.
 */
export function assertPublicationClean(files, forbidden = []) {
  const corpus = files.map((f) => (typeof f === "string" ? f : serialize(f.value ?? f))).join("\n");
  for (const token of forbidden) {
    if (corpus.includes(token)) throw new Error(`forbidden private token leaked into publication output: ${token}`);
  }
}
