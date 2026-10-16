#!/usr/bin/env node
// Conformance-fixture gate for SUK-135.
//   node tools/validate-fixtures.mjs
// Fails (exit 1) if the pinned spec drifts, a schema/form is invalid, a
// publication invariant is violated, or a vector disagrees with the oracle.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { validate, createRegistry } from "./lib/schema-validate.mjs";
import { contentHash, textContent, deepEqual } from "./lib/oracle.mjs";
import { loadInputs, renderRequirementsMarkdown } from "./build-requirements.mjs";

const ROOT = join(import.meta.dirname, "..");
const SCHEMAS_DIR = join(ROOT, "contracts", "schemas");
const CASES_DIR = join(ROOT, "fixtures", "cases");
const SPEC = join(ROOT, "docs", "spec", "blygger-0.3.md");
const SPEC_SHA = "f39eb644a9741f2e68250954e784750c9b22dd6ac2b7d7bd6c0d6eff63448a4b";
const REQUIREMENTS = JSON.parse(readFileSync(join(ROOT, "contracts", "requirements.json"), "utf8"));
const REQ_BY_ID = new Map(REQUIREMENTS.map((r) => [r.id, r]));

let passed = 0;
const failures = [];
function ok(name) { passed++; }
function bad(name, message) { failures.push({ name, message }); }

function readJson(rel) { return JSON.parse(readFileSync(join(ROOT, rel), "utf8")); }
function readText(rel) { return readFileSync(join(ROOT, rel), "utf8"); }
function loadSchemas() {
  const out = [];
  for (const f of readdirSync(SCHEMAS_DIR)) {
    if (!f.endsWith(".schema.json")) continue;
    const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, f), "utf8"));
    out.push({ id: schema.$id, schema });
  }
  return out;
}

const schemaFiles = loadSchemas();
const byName = new Map(schemaFiles.map((s) => [s.id.replace(/^blygpress:/, ""), s.schema]));
const byId = new Map(schemaFiles.map((s) => [s.id, s.schema]));
const registry = createRegistry(schemaFiles);

function jsonPointer(obj, ptr) {
  if (!ptr || ptr === "/") return obj;
  return ptr.replace(/^\//, "").split("/").reduce((cur, p) => cur?.[p.replace(/~1/g, "/").replace(/~0/g, "~")], obj);
}
// Resolve a case's target schema: a top-level schema name, or a $ref like
// "blygpress:webmention#/$defs/Request".
function resolveCaseSchema(c) {
  if (c.ref) {
    const hash = c.ref.indexOf("#");
    const base = hash === -1 ? c.ref : c.ref.slice(0, hash);
    const frag = hash === -1 ? "" : c.ref.slice(hash + 1);
    const root = byId.get(base);
    if (!root) throw new Error(`unknown schema $id '${base}'`);
    return { schema: frag ? jsonPointer(root, frag) : root, root };
  }
  const schema = byName.get(c.schema);
  if (!schema) throw new Error(`unknown schema '${c.schema}'`);
  return { schema, root: schema };
}

function specHashCheck() {
  const hex = createHash("sha256").update(readFileSync(SPEC)).digest("hex");
  if (hex !== SPEC_SHA) bad("spec.pinned", `pinned spec hash drifted: ${hex}`);
  else ok("spec.pinned");
}

// docs/REQUIREMENTS.md is generated; fail if it has drifted from its inputs.
function requirementsDocCheck() {
  try {
    const { requirements, exclusions } = loadInputs();
    const want = renderRequirementsMarkdown(requirements, exclusions);
    const got = existsSync(join(ROOT, "docs", "REQUIREMENTS.md"))
      ? readFileSync(join(ROOT, "docs", "REQUIREMENTS.md"), "utf8")
      : "";
    if (got !== want) throw new Error("stale; run `node tools/build-requirements.mjs`");
    ok("docs.requirements");
  } catch (e) {
    bad("docs.requirements", e.message);
  }
}

function schemaCheck(c) {
  let target;
  try { target = resolveCaseSchema(c); } catch (e) { return bad(c.id, e.message); }
  const input = c.input && c.input.$file ? readJson(c.input.$file) : c.input;
  const res = validate(input, target.schema, { registry, root: target.root });
  const wantValid = c.expect?.valid ?? true;
  if (res.valid !== wantValid) {
    const detail = res.valid ? "expected invalid but validated" : res.errors.map((e) => `${e.path} ${e.message}`).join("; ");
    return bad(c.id, detail);
  }
  if (wantValid && c.expect?.emitStrict && Array.isArray(target.root["x-emit-required"])) {
    const missing = target.root["x-emit-required"].filter((k) => !(k in input));
    if (missing.length) return bad(c.id, `missing emit-required fields: ${missing.join(", ")}`);
  }
  ok(c.id);
}

const ORACLE = await import("./lib/oracle.mjs");
function vectorCheck(c) {
  const [ns, fn] = c.fn.split(".");
  const target = ns === "oracle" ? ORACLE[fn] : undefined;
  if (typeof target !== "function") return bad(c.id, `unknown oracle fn '${c.fn}'`);
  const args = (c.args ?? []).map((a) => (a && a.$file ? readJson(a.$file) : a));
  let result, error = null;
  try { result = target(...args); } catch (e) { error = e; }
  if (c.expect?.error) {
    if (!error) return bad(c.id, "expected an error but none was thrown");
    return ok(c.id);
  }
  if (error) return bad(c.id, `unexpected error: ${error.message}`);
  if (!deepEqual(result, c.expect?.result)) {
    return bad(c.id, `expected ${JSON.stringify(c.expect?.result)}, got ${JSON.stringify(result)}`);
  }
  ok(c.id);
}

// A documented conformance scenario: pins the expected behaviour of a
// behavioural requirement that cannot be exercised by data alone. The check
// enforces that the scenario is well-formed and correctly linked to real
// requirement IDs, modules and issues, and that any referenced artifacts exist.
function specCheck(c) {
  const reqs = c.requirements ?? [];
  if (!reqs.length) return bad(c.id, "spec case must cite at least one requirement");
  for (const r of reqs) if (!REQ_BY_ID.has(r)) return bad(c.id, `unknown requirement '${r}'`);
  if (typeof c.spec !== "string" || !c.spec.trim()) return bad(c.id, "missing spec section");
  if (typeof c.given !== "string" || !c.given.trim()) return bad(c.id, "missing given");
  if (!c.expect || typeof c.expect.outcome !== "string" || !c.expect.outcome.trim()) {
    return bad(c.id, "missing expect.outcome");
  }
  if (!Array.isArray(c.expect.asserts) || !c.expect.asserts.length || c.expect.asserts.some((a) => typeof a !== "string" || !a.trim())) {
    return bad(c.id, "expect.asserts must be a non-empty array of strings");
  }
  const modules = new Set(reqs.map((r) => REQ_BY_ID.get(r).module));
  const issues = new Set(reqs.map((r) => REQ_BY_ID.get(r).issue));
  if (!modules.has(c.module)) return bad(c.id, `module '${c.module}' not among referenced requirements' modules: ${[...modules].join(", ")}`);
  if (!issues.has(c.issue)) return bad(c.id, `issue '${c.issue}' not among referenced requirements' issues: ${[...issues].join(", ")}`);
  for (const a of c.artifacts ?? []) {
    if (typeof a !== "string" || !existsSync(join(ROOT, a))) return bad(c.id, `artifact not found: ${a}`);
  }
  ok(c.id);
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out;
}

function parseFeed(xml) {
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

const PUB_CHECKS = {
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

function publicationCheck(c) {
  const dir = join(ROOT, c.site);
  for (const name of c.assert ?? []) {
    const fn = PUB_CHECKS[name];
    if (!fn) return bad(c.id, `unknown publication assertion '${name}'`);
    try { fn({ dir }); } catch (e) { return bad(c.id, `${name}: ${e.message}`); }
  }
  ok(c.id);
}

function privacyCheck(c) {
  const dir = join(ROOT, c.site);
  const corpus = listFiles(dir).map((f) => readFileSync(f, "utf8")).join("\n");
  for (const token of c.forbidden ?? []) {
    if (corpus.includes(token)) return bad(c.id, `forbidden private token leaked into publication output: ${token}`);
  }
  if (c.store) {
    const storeText = readFileSync(join(ROOT, c.store), "utf8");
    for (const token of c.expectInStore ?? []) {
      if (!storeText.includes(token)) return bad(c.id, `expected private token absent from store: ${token}`);
    }
  }
  ok(c.id);
}

const CHECKERS = { schema: schemaCheck, vector: vectorCheck, publication: publicationCheck, privacy: privacyCheck, spec: specCheck };

// Authoritative coverage: every requirement must cite at least one fixture and
// every fixture it cites must be defined by a case file.
function coverageCheck(definedIds) {
  let bad_ = 0;
  for (const r of REQUIREMENTS) {
    if (!Array.isArray(r.fixtures) || r.fixtures.length === 0) { bad(`coverage.${r.id}`, "requirement declares no fixtures"); bad_++; continue; }
    for (const fx of r.fixtures) {
      if (!definedIds.has(fx)) { bad(`coverage.${r.id}`, `fixture '${fx}' is not defined by any case file`); bad_++; }
    }
  }
  if (!bad_) ok("coverage.requirements-to-fixtures");
}

function main() {
  specHashCheck();
  requirementsDocCheck();
  if (!existsSync(CASES_DIR)) return report();
  const caseFiles = readdirSync(CASES_DIR).filter((f) => f.endsWith(".json")).sort();
  const cases = [];
  for (const file of caseFiles) {
    for (const c of JSON.parse(readFileSync(join(CASES_DIR, file), "utf8"))) cases.push({ file, c });
  }
  const definedIds = new Map();
  for (const { file, c } of cases) {
    if (!c.id) { bad(`${file}:case`, "case is missing an id"); continue; }
    if (definedIds.has(c.id)) bad(c.id, `duplicate case id (also defined in ${definedIds.get(c.id)})`);
    else definedIds.set(c.id, file);
  }
  for (const { c } of cases) {
    if (!c.id) continue;
    for (const r of c.requirements ?? []) {
      if (!REQ_BY_ID.has(r)) bad(c.id, `unknown requirement '${r}'`);
    }
    const checker = CHECKERS[c.check];
    if (!checker) { bad(c.id, `unknown check '${c.check}'`); continue; }
    try { checker(c); } catch (e) { bad(c.id, e.message); }
  }
  coverageCheck(definedIds);
  report();
}

function report() {
  for (const f of failures) console.error(`FAIL ${f.name}\n     ${f.message}`);
  console.log(`\n${passed} passed, ${failures.length} failed (of ${passed + failures.length} checks)`);
  if (failures.length) process.exit(1);
}

main();
