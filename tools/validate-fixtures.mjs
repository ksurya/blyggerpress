#!/usr/bin/env node
// Conformance-fixture gate for SUK-135.
//   node tools/validate-fixtures.mjs
// Fails (exit 1) if the pinned spec drifts, a schema/form is invalid, a
// publication invariant is violated, or a vector disagrees with the oracle.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { validate, createRegistry } from "./lib/schema-validate.mjs";
import { deepEqual } from "./lib/oracle.mjs";
import { PUB_CHECKS, listFiles } from "./lib/publication-checks.mjs";
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
