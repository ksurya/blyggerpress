// Shared publication-surface assertions.
//
// These are the executable semantics a published surface must satisfy. They are
// kept in one module so that the conformance-fixture gate
// (tools/validate-fixtures.mjs) and the implementation's own tests
// (test/fixtures-roundtrip.test.mjs) run the exact same checks rather than two
// drifting copies.
//
// Each check receives `{ dir }`, the root of a publication surface (a directory
// holding `items/`, `feed.xml`, `blyg.json`, ...), and throws on violation.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { contentHash } from "./oracle.mjs";

const ROOT = join(import.meta.dirname, "..", "..");

export function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

export function parseFeed(xml) {
  const channel = {};
  const ch = xml.slice(xml.indexOf("<channel>"), xml.indexOf("</channel>"));
  const pick = (re) => { const m = ch.match(re); return m ? m[1] : undefined; };
  channel.title = pick(/<title>([\s\S]*?)<\/title>/);
  channel.link = pick(/<link>([\s\S]*?)<\/link>/);
  channel.lastBuildDate = pick(/<lastBuildDate>([\s\S]*?)<\/lastBuildDate>/);
  channel.manifest = pick(/<blyg:manifest>([\s\S]*?)<\/blyg:manifest>/);
  const entries = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const b = m[1];
    const g = (re) => { const mm = b.match(re); return mm ? mm[1] : undefined; };
    entries.push({
      guid: g(/<guid[^>]*>([\s\S]*?)<\/guid>/),
      link: g(/<link>([\s\S]*?)<\/link>/),
      title: g(/<title>([\s\S]*?)<\/title>/),
      description: g(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ?? "",
      version: g(/<blyg:version>([\s\S]*?)<\/blyg:version>/),
      kind: g(/<blyg:kind>([\s\S]*?)<\/blyg:kind>/),
      id: g(/<blyg:id>([\s\S]*?)<\/blyg:id>/),
    });
  }
  return { channel, entries };
}

export const PUB_CHECKS = {
  "index-consistent"({ dir }) {
    const index = JSON.parse(readFileSync(join(dir, "items/index.json"), "utf8"));
    const itemFiles = readdirSync(join(dir, "items")).filter((f) => f.endsWith(".json") && f !== "index.json");
    const ids = new Set(itemFiles.map((f) => f.replace(/\.json$/, "")));
    const missing = index.items.filter((it) => !ids.has(it.id)).map((it) => it.id);
    if (missing.length) throw new Error(`index lists items with no document: ${missing.join(", ")}`);
    for (const it of index.items) {
      const doc = JSON.parse(readFileSync(join(dir, "items", `${it.id}.json`), "utf8"));
      if (doc.version !== it.version) throw new Error(`${it.id}: index version ${it.version} != doc ${doc.version}`);
      if (doc.kind !== it.kind) throw new Error(`${it.id}: index kind mismatch`);
    }
  },
  "index-order"({ dir }) {
    const index = JSON.parse(readFileSync(join(dir, "items/index.json"), "utf8"));
    for (let i = 1; i < index.items.length; i++) {
      if (index.items[i - 1].updated < index.items[i].updated) throw new Error("index not ordered by updated desc");
    }
  },
  "updated-equals-latest-changelog"({ dir }) {
    for (const f of readdirSync(join(dir, "items")).filter((f) => f.endsWith(".json") && f !== "index.json")) {
      const doc = JSON.parse(readFileSync(join(dir, "items", f), "utf8"));
      const last = doc.changelog[doc.changelog.length - 1];
      if (doc.updated !== last.at) throw new Error(`${doc.id}: updated ${doc.updated} != latest changelog at ${last.at}`);
    }
  },
  "hashes-valid"({ dir }) {
    const walk = (d) => {
      for (const entry of readdirSync(d)) {
        const full = join(d, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!full.endsWith(".json") || entry === "index.json" || entry === "blyg.json") continue;
        const doc = JSON.parse(readFileSync(full, "utf8"));
        if (typeof doc.content_md !== "string") continue;
        if (doc.content_hash !== contentHash(doc.content_md)) throw new Error(`${relative(ROOT, full)}: content_hash mismatch`);
      }
    };
    walk(join(dir, "items"));
  },
  "pins-present"({ dir }) {
    for (const f of readdirSync(join(dir, "items")).filter((f) => f.endsWith(".json") && f !== "index.json")) {
      const doc = JSON.parse(readFileSync(join(dir, "items", f), "utf8"));
      for (const entry of doc.changelog ?? []) {
        const pinFile = join(dir, "items", doc.id, `v${entry.version}.json`);
        if (entry.pinned && !existsSync(pinFile)) throw new Error(`${doc.id}: changelog marks v${entry.version} pinned but no pin file`);
        if (!entry.pinned && existsSync(pinFile)) throw new Error(`${doc.id}: v${entry.version} is unpinned but a pin file exists (unpinned history must 404)`);
      }
    }
  },
  "feed-latest-content"({ dir }) {
    const feed = parseFeed(readFileSync(join(dir, "feed.xml"), "utf8"));
    for (const e of feed.entries) {
      const doc = JSON.parse(readFileSync(join(dir, "items", `${e.id}.json`), "utf8"));
      if (doc.kind === "withdrawn") {
        if (e.description !== "") throw new Error(`withdrawn entry ${e.id} must have empty description`);
        continue;
      }
      if (e.description !== doc.content_html) throw new Error(`entry ${e.id} v${e.version} description is not the latest content`);
    }
  },
  "feed-manifest-absolute"({ dir }) {
    const feed = parseFeed(readFileSync(join(dir, "feed.xml"), "utf8"));
    if (!/^https?:\/\//.test(feed.channel.manifest ?? "")) throw new Error("channel <blyg:manifest> must be absolute");
  },
  "withdrawn-single-entry"({ dir }) {
    const feed = parseFeed(readFileSync(join(dir, "feed.xml"), "utf8"));
    for (const f of readdirSync(join(dir, "items")).filter((f) => f.endsWith(".json") && f !== "index.json")) {
      const doc = JSON.parse(readFileSync(join(dir, "items", f), "utf8"));
      if (doc.kind !== "withdrawn") continue;
      const rows = feed.entries.filter((e) => e.id === doc.id);
      if (rows.length !== 1) throw new Error(`${doc.id}: withdrawn item must contribute exactly one feed entry`);
      if (rows[0].title !== "withdrawn") throw new Error(`${doc.id}: withdrawn entry title must be literal 'withdrawn'`);
    }
  },
  "pages-have-alternate"({ dir }) {
    const pages = listFiles(dir).filter((f) => /\/[ft]\/[^/]+\/index\.html$/.test(f));
    for (const p of pages) {
      const html = readFileSync(p, "utf8");
      if (!/rel="alternate"[^>]*type="application\/json"|type="application\/json"[^>]*rel="alternate"/.test(html)) {
        throw new Error(`${relative(ROOT, p)}: permalink page lacks rel=alternate JSON link`);
      }
    }
  },
  "manifest-surface-files-exist"({ dir }) {
    const m = JSON.parse(readFileSync(join(dir, "blyg.json"), "utf8"));
    for (const key of ["feed", "items"]) {
      if (!existsSync(join(dir, m[key]))) throw new Error(`manifest ${key}=${m[key]} does not exist`);
    }
  },
  "manifest-keys-consistent"({ dir }) {
    const m = JSON.parse(readFileSync(join(dir, "blyg.json"), "utf8"));
    for (const k of ["blyg", "site", "title", "feed", "items", "updated"]) {
      if (!(k in m)) throw new Error(`manifest missing required key '${k}'`);
    }
    if (m.blogroll && !existsSync(join(dir, m.blogroll))) throw new Error(`manifest advertises blogroll '${m.blogroll}' but the file is absent`);
    if (!m.blogroll && existsSync(join(dir, "blogroll.opml"))) throw new Error("blogroll.opml exists but the manifest omits the blogroll key (spec 11)");
    if (m.webmention && !m.blogroll) throw new Error("webmention key present without the corresponding surface check");
  },
  "index-includes-withdrawn"({ dir }) {
    const index = JSON.parse(readFileSync(join(dir, "items/index.json"), "utf8"));
    if (!index.items.some((it) => it.kind === "withdrawn")) throw new Error("archive index must include withdrawn items (no window, spec 6.2)");
  },
  "no-unpinned-history-route"({ dir }) {
    // Every version file that exists must be a pinned changelog entry, and no
    // unpinned version file may exist: unpinned history must 404 (spec 8.4).
    for (const f of readdirSync(join(dir, "items")).filter((f) => f.endsWith(".json") && f !== "index.json")) {
      const doc = JSON.parse(readFileSync(join(dir, "items", f), "utf8"));
      for (const entry of doc.changelog ?? []) {
        const pinFile = join(dir, "items", doc.id, `v${entry.version}.json`);
        if (entry.pinned !== true && existsSync(pinFile)) throw new Error(`${doc.id}: v${entry.version} is unpinned but a version file exists (must 404)`);
        if (entry.pinned === true && !existsSync(pinFile)) throw new Error(`${doc.id}: v${entry.version} is pinned but the version file is missing`);
      }
    }
  },
  "feed-guid-per-version"({ dir }) {
    const xml = readFileSync(join(dir, "feed.xml"), "utf8");
    const guids = xml.match(/<guid\b[^>]*>/g) ?? [];
    if (guids.some((g) => !/isPermaLink="false"/.test(g))) throw new Error("every <guid> must carry isPermaLink=\"false\" (spec 7)");
    const feed = parseFeed(xml);
    for (const e of feed.entries) {
      const m = /^blyg:([0-9abcdefghjkmnpqrstvwxyz]{26}):v([0-9]+)$/.exec(e.guid ?? "");
      if (!m) throw new Error(`entry guid '${e.guid}' is not blyg:{id}:v{n}`);
      if (m[1] !== e.id) throw new Error(`guid id ${m[1]} != blyg:id ${e.id}`);
      if (Number(m[2]) !== Number(e.version)) throw new Error(`guid version ${m[2]} != blyg:version ${e.version}`);
    }
  },
  "feed-link-is-page"({ dir }) {
    const manifest = JSON.parse(readFileSync(join(dir, "blyg.json"), "utf8"));
    const origin = manifest.site.endsWith("/") ? manifest.site : `${manifest.site}/`;
    const feed = parseFeed(readFileSync(join(dir, "feed.xml"), "utf8"));
    const slash = (u) => (u.endsWith("/") ? u : `${u}/`);
    for (const e of feed.entries) {
      const doc = JSON.parse(readFileSync(join(dir, "items", `${e.id}.json`), "utf8"));
      if (!doc.page) continue;
      const page = /^https?:/.test(doc.page) ? doc.page : origin + doc.page;
      if (slash(page) !== slash(e.link)) throw new Error(`entry ${e.id} link ${e.link} does not name its page ${page} (spec 7)`);
    }
  },
  "feed-entries-equal-publish-events"({ dir }) {
    const feed = parseFeed(readFileSync(join(dir, "feed.xml"), "utf8"));
    let expected = 0;
    for (const f of readdirSync(join(dir, "items")).filter((f) => f.endsWith(".json") && f !== "index.json")) {
      const doc = JSON.parse(readFileSync(join(dir, "items", f), "utf8"));
      expected += doc.kind === "withdrawn" ? 1 : (doc.changelog ?? []).length; // pinning emits no feed event
    }
    if (feed.entries.length !== expected) throw new Error(`feed has ${feed.entries.length} entries; ${expected} publish events expected (pins emit no event, spec 7)`);
  },
  "feed-self-contained"({ dir }) {
    const xml = readFileSync(join(dir, "feed.xml"), "utf8");
    if (/<script[\s>]/i.test(xml)) throw new Error("feed must not carry scripts (spec 7)");
    if (/rel="stylesheet"/i.test(xml)) throw new Error("feed must not reference stylesheets (spec 7)");
  },
};

/**
 * The item-scoped subset of the publication checks: those that read only
 * `items/`, so an item projection can be verified without the feed, manifest or
 * archive index (which SUK-138 owns).
 */
export const ITEM_SCOPE_CHECKS = Object.freeze([
  "updated-equals-latest-changelog",
  "hashes-valid",
  "pins-present",
  "no-unpinned-history-route",
]);
