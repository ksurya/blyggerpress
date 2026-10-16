// Test helpers: a fixture-backed implementation of the importer's ports.
//
// Nothing here ships; it lets the tests drive `pollSubscription`/`reconcileIndex`
// against the committed `fixtures/wire/**` trees without a network, and inject
// failures, 404s, 304s and stale feeds to exercise §13.2 degradation paths.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseFeed } from "../../src/blyg/feed-reader.mjs";
import { parseArchiveIndex } from "../../src/blyg/reconcile.mjs";

export const ROOT = join(import.meta.dirname, "..", "..");

export const ORIGIN = "https://example.com/blyg/";
export const REMOTE = "https://blyg.protocol-institute.org/";
export const NOW = "2026-10-16T12:00:00Z";

export function readJson(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

export function readText(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

/**
 * Build ports backed by a `fixtures/wire/<dir>` tree served at `mount`, with an
 * override map for injecting responses (value or `(req) => response`, where a
 * thrown error simulates a transport failure).
 */
export function createFixturePorts({ mount = null, dir = null, now = NOW, overrides = {} } = {}) {
  const state = { overrides: { ...overrides }, log: [] };
  let clock = now;

  const respond = async (url, req) => {
    state.log.push(url);
    if (url in state.overrides) {
      const ov = state.overrides[url];
      return typeof ov === "function" ? ov(req, state) : ov;
    }
    if (mount && dir && url.startsWith(mount)) {
      const rel = url.slice(mount.length);
      const full = join(ROOT, "fixtures", "wire", dir, rel);
      if (existsSync(full)) {
        const etag = `W/"${rel}"`;
        if (req.etag && req.etag === etag) return { status: 304, body: "", etag };
        return { status: 200, body: readFileSync(full, "utf8"), etag, lastModified: "2026-07-24T09:00:00Z" };
      }
    }
    return { status: 404, body: "" };
  };

  return {
    fetchText: (url, req = {}) => respond(url, req),
    parseFeed,
    parseIndex: parseArchiveIndex,
    now: () => clock,
    log: state.log,
    setNow: (v) => {
      clock = v;
    },
    setOverride: (url, value) => {
      state.overrides[url] = value;
    },
    clearOverride: (url) => {
      delete state.overrides[url];
    },
  };
}

export function blygResolver() {
  return async () => ({ mode: "blyg", identityOrigin: ORIGIN, manifestUrl: `${ORIGIN}blyg.json`, feedUrl: `${ORIGIN}feed.xml`, title: "Example Studio blyg" });
}

export function remoteResolver() {
  return async () => ({ mode: "blyg", identityOrigin: REMOTE, manifestUrl: `${REMOTE}blyg.json`, feedUrl: `${REMOTE}feed.xml`, title: "Protocol Institute Blyg" });
}
