#!/usr/bin/env node
// Generates docs/REQUIREMENTS.md from contracts/requirements.json and
// contracts/exclusions.json. The generated document is the human-readable
// traceability matrix; the JSON files are authoritative.
//
//   node tools/build-requirements.mjs          # write docs/REQUIREMENTS.md
//   node tools/build-requirements.mjs --check  # fail if the file is stale
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const REQ_FILE = join(ROOT, "contracts", "requirements.json");
const EXC_FILE = join(ROOT, "contracts", "exclusions.json");
const OUT_FILE = join(ROOT, "docs", "REQUIREMENTS.md");

export function loadInputs() {
  return {
    requirements: JSON.parse(readFileSync(REQ_FILE, "utf8")),
    exclusions: JSON.parse(readFileSync(EXC_FILE, "utf8")),
  };
}

function sectionKey(section) {
  return String(section)
    .split(".")
    .map((n) => String(Number(n)).padStart(3, "0"))
    .join(".");
}
function reqKey(r) {
  return `${sectionKey(r.section)} ${r.id}`;
}
function mdCell(s) {
  return String(s).replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

export function renderRequirementsMarkdown(requirements, exclusions) {
  const byModule = new Map();
  for (const r of requirements) {
    if (!byModule.has(r.module)) byModule.set(r.module, []);
    byModule.get(r.module).push(r);
  }
  for (const list of byModule.values()) list.sort((a, b) => reqKey(a).localeCompare(reqKey(b)));

  const byIssue = new Map();
  for (const r of [...requirements].sort((a, b) => a.issue.localeCompare(b.issue))) {
    byIssue.set(r.issue, (byIssue.get(r.issue) || 0) + 1);
  }
  const optional = requirements.filter((r) => r.optional).length;
  const informative = requirements.filter((r) => r.informative).length;

  const fixtureSet = new Set();
  for (const r of requirements) for (const fx of r.fixtures ?? []) fixtureSet.add(fx);

  const modules = [...byModule.keys()].sort();

  const lines = [];
  lines.push("# Requirements and traceability");
  lines.push("");
  lines.push("> **Generated file.** Do not edit by hand. Run `node tools/build-requirements.mjs`.");
  lines.push("> The authoritative registry is [`contracts/requirements.json`](../contracts/requirements.json);");
  lines.push("> the exclusion list is [`contracts/exclusions.json`](../contracts/exclusions.json).");
  lines.push("> `tools/validate-fixtures.mjs` fails if this file is stale or if any requirement's");
  lines.push("> fixtures are not defined by a conformance case.");
  lines.push("");
  lines.push("## What this is");
  lines.push("");
  lines.push("Every normative and MVP-optional requirement of the pinned Blygger 0.3 spec");
  lines.push("(§§2–15), mapped to the module that owns it, the implementation issue that");
  lines.push("delivers it, and the conformance fixtures that pin it. Sections 16 and 17 are");
  lines.push("non-normative; §16 is summarised under [Excluded constructs](#excluded-constructs).");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Requirements: **${requirements.length}** (${optional} optional/MAY/RECOMMENDED, ${informative} informative).`);
  lines.push(`- Modules: **${modules.length}**.`);
  lines.push(`- Implementation issues: **${byIssue.size}**.`);
  lines.push(`- Conformance fixtures referenced: **${fixtureSet.size}** (see [\`fixtures/\`](../fixtures/README.md)).`);
  lines.push("");
  lines.push("| Issue | Requirements |");
  lines.push("|---|---:|");
  for (const [issue, n] of [...byIssue.entries()].sort()) lines.push(`| ${issue} | ${n} |`);
  lines.push("");
  lines.push("## Excluded constructs");
  lines.push("");
  lines.push("The constructs below are non-normative in the pinned text (§16) and are **out of");
  lines.push("scope** for this MVP. Each row records the room, if any, the MVP must leave.");
  lines.push("");
  lines.push("| ID | § | Construct | Status | Room left |");
  lines.push("|---|---|---|---|---|");
  for (const e of exclusions.excluded) {
    lines.push(`| ${e.id} | ${e.section} | ${mdCell(e.title)} | ${mdCell(e.status)} | ${mdCell(e.room)} |`);
  }
  lines.push("");
  lines.push("## Traceability matrix");
  lines.push("");
  lines.push("Grouped by owning module. `Keyword` is the RFC 2119 modal; `Optional` marks an");
  lines.push("MVP-optional feature that is nonetheless made available (so it is in scope).");
  lines.push("");
  for (const module of modules) {
    lines.push(`### \`${module}\``);
    lines.push("");
    lines.push("| ID | § | Keyword | Issue | Optional | Fixtures | Statement |");
    lines.push("|---|---|---|---|:--:|---|---|");
    for (const r of byModule.get(module)) {
      const fx = (r.fixtures ?? []).map((f) => `\`${f}\``).join("<br>");
      lines.push(
        `| ${r.id} | ${r.section} | ${r.keyword} | ${r.issue} | ${r.optional ? "✔" : ""} | ${fx} | ${mdCell(r.statement)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

function main() {
  const { requirements, exclusions } = loadInputs();
  const markdown = renderRequirementsMarkdown(requirements, exclusions);
  if (process.argv.includes("--check")) {
    const current = existsSync(OUT_FILE) ? readFileSync(OUT_FILE, "utf8") : "";
    if (current !== markdown) {
      console.error("docs/REQUIREMENTS.md is stale; run `node tools/build-requirements.mjs`.");
      process.exit(1);
    }
    console.log("docs/REQUIREMENTS.md is up to date.");
    return;
  }
  writeFileSync(OUT_FILE, markdown);
  console.log(`wrote ${OUT_FILE} (${requirements.length} requirements, ${exclusions.excluded.length} exclusions)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
