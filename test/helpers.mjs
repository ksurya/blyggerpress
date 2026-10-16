// Shared test helpers: fixture loading, the committed publication surfaces, and
// a seed-from-documents path that rebuilds item state from the exact committed
// wire documents (so the builders can be checked against them, including items
// whose earlier versions are withheld and therefore have no readable content).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");

export function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

export function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

export function repoPath(rel) {
  return join(ROOT, rel);
}

export function loadCases() {
  const dir = join(ROOT, "fixtures", "cases");
  const out = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    for (const c of readJson(join("fixtures", "cases", file))) out.push(c);
  }
  return out;
}

export function casesWhere(predicate) {
  return loadCases().filter(predicate);
}

export function requirementsForIssue(issue) {
  return readJson("contracts/requirements.json").filter((r) => r.issue === issue);
}

export function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The ids of the items in the committed sample blyg. */
export const SAMPLE_ITEM_IDS = [
  "0ff73f8ranqzaf0b2n3qpxxzd7",
  "1jt332depwffcsyfz9txf8c9r9",
  "3ev1cjtw7c6q5y8cd0r7aj3bhc",
  "3wh683yzk9m9byd7tr17fpaxfs",
  "6y1e4khfxxckyd9dhwgrtv2dj4",
  "7jbfafqm50v2w8xd9hkxz3yesh",
];

/** A withdrawal endcap keeps its page, whose prefix names the authored kind. */
export function inferAuthoredKind(doc) {
  if ("transclusions" in doc) return "thread";
  if (typeof doc.page === "string" && doc.page.startsWith("t/")) return "thread";
  return "fragment";
}

/**
 * Rebuild an item state from its committed canonical document plus its pinned
 * version documents. Versions whose content was withdrawn and unpinned stay as
 * bare changelog records, exactly as the publisher withholds them — the
 * builders must never need their content.
 */
export function seedItemFromDocuments(doc, pinnedDocs = []) {
  const versions = doc.changelog.map((entry) => ({
    version: entry.version,
    at: entry.at,
    note: entry.note ?? null,
    noteGenerated: Boolean(entry.generated),
    pinned: Boolean(entry.pinned),
  }));
  const last = versions[versions.length - 1];
  last.kind = doc.kind;
  last.content_md = doc.content_md;
  last.content_html = doc.content_html;
  last.content_hash = doc.content_hash;
  last.media = doc.kind === "withdrawn" ? [] : (doc.media ?? []);
  if (doc.kind !== "withdrawn") {
    if (doc.transclusions) last.transclusions = doc.transclusions;
    if (doc.generated) last.generated = doc.generated;
    if (doc.stub_of) last.stub_of = doc.stub_of;
  }
  for (const pin of pinnedDocs) {
    const v = versions.find((x) => x.version === pin.version);
    if (!v) throw new Error(`pinned version v${pin.version} is not in the changelog`);
    v.kind = pin.kind;
    v.at = pin.at;
    v.note = pin.note ?? null;
    v.pinned = true;
    v.content_md = pin.content_md;
    v.content_html = pin.content_html;
    v.content_hash = pin.content_hash;
    v.media = [];
    if (pin.transclusions) v.transclusions = pin.transclusions;
    if (pin.generated) v.generated = pin.generated;
    if (pin.stub_of) v.stub_of = pin.stub_of;
  }
  return {
    id: doc.id,
    origin: doc.origin,
    page: doc.page,
    author: doc.author,
    createdAt: doc.created,
    kind: doc.kind === "withdrawn" ? inferAuthoredKind(doc) : doc.kind,
    forkedFrom: doc.forked_from,
    versions,
  };
}

export function loadSampleItems() {
  const dir = join("fixtures", "wire", "sample-blyg", "items");
  return SAMPLE_ITEM_IDS.map((id) => {
    const doc = readJson(join(dir, `${id}.json`));
    let pinnedDocs = [];
    try {
      pinnedDocs = readdirSync(repoPath(join(dir, id)))
        .filter((f) => /^v\d+\.json$/.test(f))
        .sort()
        .map((f) => readJson(join(dir, id, f)));
    } catch {
      pinnedDocs = [];
    }
    return seedItemFromDocuments(doc, pinnedDocs);
  });
}
