import { createSafeFetch } from './fetch.mjs';
import { resolveSubscription } from './resolve.mjs';
// Reader import pipeline: pairs `blyg/reconcile` with discovery and fetching so
// both import paths — the cheap feed trigger and the total archive-index diff —
// reuse one import state and one failure path (spec §12.3, §13.2).
//
// This module owns orchestration, not wire protocol. Discovery (`blyg/resolve`,
// SUK-139) and fetching (`blyg/fetch`, SUK-139) use injectable PORTS so the
// production resolver/fetcher share this pipeline, and tests drive
// the same code against the committed fixtures:
//
//   ports.resolveSubscription(url) -> { mode, identityOrigin, manifestUrl, feedUrl, title }
//   ports.fetchText(url, { etag, lastModified, signal })
//        -> { status, body, etag?, lastModified?, finalUrl?, retryAfter? }
//           (throws on a transport failure; conditional requests honor 304)
//   ports.parseFeed(xml) -> feed model          (default: blyg/feed-reader, §7)
//   ports.parseIndex(text) -> archive index     (default: blyg/reconcile, §6.2)
//   ports.now() -> ISO 8601 UTC instant         (default: Date)
//
// Failure handling is shared and non-destructive: a poll failure schedules
// backoff and never mutates stored items or watermarks; a single item fetch
// failure is isolated; a missing archive index marks the subscription lossy and
// degrades to feed-window-only operation.
import { normalizeOrigin, originKey, sha256Hex, nowIso } from "./primitives.mjs";
import { parseFeed } from "./feed-reader.mjs";
import {
  ensureStore,
  reconcileIndex,
  feedTriggers,
  detectFeedGap,
  importCanonicalItem,
  wrapLegacyEntry,
  parseArchiveIndex,
} from "./reconcile.mjs";

export const DEFAULT_INDEX_INTERVAL_MS = 6 * 60 * 60 * 1000; // one index diff per ~6h regardless of suspicion
export const BASE_BACKOFF_MS = 60_000;
export const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

const clone = (value) => (value == null ? value : structuredClone(value));

export function createStore(seed = {}) {
  return { schemaVersion: 1, subscriptions: [], imported: [], ...seed };
}

function shortHash(input) {
  return sha256Hex(input).slice(0, 12);
}

// ----------------------------------------------------------------- ports

function defaultPorts(ports = {}) {
  return {
    fetchText: createSafeFetch(),
    resolveSubscription,
    now: nowIso,
    parseFeed,
    parseIndex: parseArchiveIndex,
    ...ports,
  };
}

/**
 * Establish a subscription from a URL by delegating to discovery (§12.1).
 * Returns the updated store and the new subscription, or a surfaced failure.
 */
export async function subscribe(store, url, ports = {}, { at } = {}) {
  const st = clone(ensureStore(store));
  const p = defaultPorts(ports);
  const when = at ?? p.now();

  let resolved;
  try {
    resolved = await p.resolveSubscription(url, { fetchText: p.fetchText, parseFeed: p.parseFeed });
  } catch (error) {
    return { store: st, ok: false, reason: "resolution-failed", error: String(error?.message ?? error), tried: error.tried, fallback: "import-feed" };
  }
  if (!resolved || (!resolved.identityOrigin && !resolved.feedUrl)) {
    return { store: st, ok: false, reason: "resolution-failed" };
  }

  const mode = resolved.mode === "legacy" ? "legacy" : "blyg";
  const identityOrigin = mode === "legacy" ? resolved.feedUrl ?? resolved.identityOrigin : normalizeOrigin(resolved.identityOrigin);
  const id = resolved.id ?? `sub-${shortHash(`${mode}:${identityOrigin}`)}`;

  if (st.subscriptions.some((s) => s.id === id)) {
    return { store: st, ok: true, subscription: st.subscriptions.find((s) => s.id === id), alreadySubscribed: true };
  }

  const subscription = {
    id,
    mode,
    identityOrigin,
    manifestUrl: resolved.manifestUrl ?? null,
    feedUrl: resolved.feedUrl ?? null,
    title: resolved.title ?? identityOrigin,
    notices: resolved.notices ?? [],
    blogrollVisible: false,
    lossy: false,
    etag: null,
    lastModified: null,
    backoffUntil: null,
    lastPolledAt: null,
    addedAt: when,
  };
  st.subscriptions.push(subscription);
  return { store: st, ok: true, subscription };
}

// ----------------------------------------------------------------- polling

function findSubscription(store, id) {
  return ensureStore(store).subscriptions.find((s) => s.id === id) ?? null;
}

function isDue(sub, at, now) {
  if (!sub.backoffUntil) return true;
  return String(sub.backoffUntil) <= at;
}

function scheduleBackoff(sub, at, { retryAfterMs } = {}) {
  const failures = Number(sub.failureCount ?? 0) + 1;
  sub.failureCount = failures;
  const delay = Math.max(
    Math.min(BASE_BACKOFF_MS * 2 ** Math.min(failures - 1, 30), MAX_BACKOFF_MS),
    Number(sub.lastBackoffMs ?? 0),
    Number.isFinite(retryAfterMs) ? retryAfterMs : 0,
  );
  sub.lastBackoffMs = delay;
  sub.backoffUntil = new Date(Date.parse(at) + delay).toISOString();
  return sub;
}

async function fetchItemDocument(ports, origin, id, signal) {
  const url = `${origin}items/${id}.json`;
  const res = await ports.fetchText(url, { signal });
  if (!res || res.status !== 200 || (res.finalUrl && res.finalUrl !== url)) return null;
  try {
    return JSON.parse(res.body);
  } catch {
    return null;
  }
}

async function applyTriggers(store, { origin, triggers, ports, at }) {
  let st = store;
  const applied = [];
  for (const trigger of triggers) {
    const url = `${origin}items/${trigger.id}.json`;
    let doc = null;
    try {
      const res = await ports.fetchText(url, { signal: ports.signal });
      if (!res || res.status !== 200 || (res.finalUrl && res.finalUrl !== url)) continue;
      try {
        doc = JSON.parse(res.body);
      } catch {
        continue; // an unparseable document is skipped, never stored
      }
    } catch {
      continue; // an isolated fetch failure never mutates stored state
    }
    const res = importCanonicalItem(st, { origin, doc, observedAt: at });
    st = res.store;
    applied.push({ id: trigger.id, outcome: res.outcome });
  }
  return { store: st, applied };
}

/**
 * Poll one subscription. The feed is a cheap trigger; a full archive-index diff
 * runs on first subscribe, on a suspected feed-window gap, when the feed is
 * unparseable, or periodically. Only fetched documents advance state.
 */
export async function pollSubscription(store, subscriptionId, ports = {}, { manual = false, forceIndex = false, indexIntervalMs = DEFAULT_INDEX_INTERVAL_MS } = {}) {
  const p = defaultPorts(ports);
  const at = p.now();
  let st = clone(ensureStore(store));
  const sub = st.subscriptions.find((s) => s.id === subscriptionId);
  if (!sub) return { store: st, ok: false, reason: "unknown-subscription" };
  if (!manual && !isDue(sub, at)) return { store: st, ok: false, reason: "backoff", nextAttemptAt: sub.backoffUntil };

  const origin = sub.mode === "legacy" ? sub.identityOrigin : normalizeOrigin(sub.identityOrigin);
  const feedUrl = sub.feedUrl ?? (sub.mode === "legacy" ? sub.identityOrigin : `${origin}feed.xml`);

  // 1. Cheap trigger: a conditional feed fetch. Never authoritative.
  let feedModel = null;
  let feedStatus = "absent";
  if (feedUrl) {
    let res;
    try {
      res = await p.fetchText(feedUrl, { etag: sub.etag, lastModified: sub.lastModified, signal: p.signal });
    } catch (error) {
      scheduleBackoff(sub, at);
      return { store: st, ok: false, reason: "poll-failed", error: String(error?.message ?? error), nextAttemptAt: sub.backoffUntil };
    }
    if (res?.finalUrl && res.finalUrl !== feedUrl) {
      scheduleBackoff(sub, at);
      return { store: st, ok: false, reason: "identity-change", proposedUrl: res.finalUrl };
    }
    if (res?.status === 304) {
      feedStatus = "not-modified";
    } else if (res?.status === 200) {
      try {
        feedModel = p.parseFeed(res.body, { baseUrl: feedUrl });
        feedStatus = "changed";
      } catch {
        feedStatus = "unparseable"; // §13.2: an unparseable feed goes straight to an index diff
      }
      sub.etag = res.etag ?? null;
      sub.lastModified = res.lastModified ?? null;
    } else if (res?.status === 429 || res?.status === 503) {
      scheduleBackoff(sub, at, { retryAfterMs: parseRetryAfter(res.retryAfter, at) });
      return { store: st, ok: false, reason: "rate-limited", nextAttemptAt: sub.backoffUntil };
    } else if (res && res.status >= 500) {
      scheduleBackoff(sub, at);
      return { store: st, ok: false, reason: "poll-failed", status: res.status, nextAttemptAt: sub.backoffUntil };
    } else if (res?.status === 404) {
      feedStatus = "unparseable"; // a feed that never came back is handled by the index diff
    } else {
      feedStatus = "unusable";
    }
  }

  // Legacy L0: wrap the feed window; there is no index and no withdrawal (spec 13.6).
  if (sub.mode === "legacy") {
    if (!feedModel && feedStatus !== "not-modified") {
      scheduleBackoff(sub, at);
      return { store: st, ok: false, reason: "poll-failed", nextAttemptAt: sub.backoffUntil };
    }
    let wrapped = 0;
    if (feedModel) {
      for (const entry of feedModel.entries ?? []) {
        try {
          const r = wrapLegacyEntry(st, { origin, entry, observedAt: at });
          st = r.store;
          if (r.outcome !== "l0-unchanged") wrapped++;
        } catch {
          // skip an unparseable entry individually
        }
      }
    }
    sub.lastPolledAt = at;
    sub.backoffUntil = null;
    sub.failureCount = 0;
    sub.lastBackoffMs = 0;
    return { store: st, ok: true, mode: "legacy", feed: feedStatus, wrapped };
  }

  // 2. Decide whether to run the total reconciliation (the index diff).
  const firstSubscribe = !sub.lastPolledAt || !st.imported.some((r) => originKey(r.origin) === origin);
  const gap = feedModel ? detectFeedGap(sub.feedHead, feedModel) : false;
  const indexDue =
    forceIndex ||
    firstSubscribe ||
    gap ||
    feedStatus === "unparseable" ||
    isIndexStale(sub, at, indexIntervalMs);

  const triggers = feedModel ? feedTriggers(st, { origin, feedModel }) : [];

  let indexResult = null;
  let applied = [];
  if (indexDue) {
    const indexUrl = `${origin}items/index.json`;
    let res;
    try {
      res = await p.fetchText(indexUrl, { signal: p.signal });
    } catch (error) {
      scheduleBackoff(sub, at);
      return { store: st, ok: false, reason: "poll-failed", error: String(error?.message ?? error), nextAttemptAt: sub.backoffUntil };
    }
    if (res?.finalUrl && res.finalUrl !== indexUrl) {
      scheduleBackoff(sub, at);
      return { store: st, ok: false, reason: "identity-change", proposedUrl: res.finalUrl };
    }
    if (res?.status === 200) {
      let index = null;
      try {
        index = p.parseIndex(res.body);
      } catch {
        index = null;
      }
      indexResult = await reconcileIndex(st, {
        origin,
        index,
        fetchItem: (id) => fetchItemDocument(p, origin, id, p.signal),
        observedAt: at,
      });
      st = indexResult.store;
      sub.lossy = indexResult.lossy === true;
      if (!indexResult.lossy) sub.lastIndexAt = at;
    } else if (res?.status === 404) {
      // Nonconforming publisher: fall back to feed-window-only and surface it.
      sub.lossy = true;
      const r = await applyTriggers(st, { origin, triggers, ports: p, at });
      st = r.store;
      applied = r.applied;
    } else if (res?.status === 429 || res?.status === 503) {
      scheduleBackoff(sub, at, { retryAfterMs: parseRetryAfter(res.retryAfter, at) });
      return { store: st, ok: false, reason: "rate-limited", nextAttemptAt: sub.backoffUntil };
    } else {
      scheduleBackoff(sub, at);
      return { store: st, ok: false, reason: "poll-failed", status: res?.status, nextAttemptAt: sub.backoffUntil };
    }
  } else {
    const r = await applyTriggers(st, { origin, triggers, ports: p, at });
    st = r.store;
    applied = r.applied;
  }

  // 3. Advance the non-item bookkeeping only after a non-destructive poll.
  if (feedModel && feedModel.entries?.[0]?.guid) sub.feedHead = feedModel.entries[0].guid;
  sub.lastPolledAt = at;
  sub.backoffUntil = null;
  sub.failureCount = 0;
  sub.lastBackoffMs = 0;

  return {
    store: st,
    ok: true,
    mode: indexDue ? "index" : "trigger",
    feed: feedStatus,
    triggers,
    applied,
    index: indexResult,
    lossy: sub.lossy === true,
  };
}

function isIndexStale(sub, at, intervalMs) {
  if (!sub.lastIndexAt) return true;
  return Date.parse(at) - Date.parse(sub.lastIndexAt) >= intervalMs;
}

function parseRetryAfter(value, at) {
  if (value == null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(String(value));
  if (Number.isFinite(date)) return Math.max(0, date - Date.parse(at));
  return undefined;
}

/** Poll every subscription that is due. Failures are per-subscription and isolated. */
export async function pollAll(store, ports = {}, options = {}) {
  const p = defaultPorts(ports);
  const at = p.now();
  let st = clone(ensureStore(store));
  const results = [];
  for (const sub of st.subscriptions) {
    if (!isDue(sub, at)) {
      results.push({ id: sub.id, ok: false, reason: "backoff" });
      continue;
    }
    const r = await pollSubscription(st, sub.id, p, options);
    st = r.store;
    results.push({ id: sub.id, ok: r.ok, reason: r.reason, mode: r.mode });
  }
  return { store: st, results };
}

/** Browser-compatible bounded HTTP ports; an explicit proxy can be supplied as fetchImpl. */
export function createHttpPorts(options = {}) {
  return { fetchText: createSafeFetch(options), resolveSubscription, parseFeed, parseIndex: parseArchiveIndex, now: nowIso };
}

/** A deliberate refresh bypasses scheduling, and uses the same reconciliation. */
export function refreshSubscription(store, id, ports = {}) {
  return pollSubscription(store, id, ports, { manual: true, forceIndex: true });
}

/** File import fallback: no network and no inferred blyg authority from XML. */
export async function importFeedFile(store, { feedUrl, text }, ports = {}) {
  const model = (ports.parseFeed ?? parseFeed)(text, { baseUrl: feedUrl });
  const { publicUrl } = await import('./fetch.mjs');
  const url = publicUrl(feedUrl);
  const result = await subscribe(store, url, { ...ports, resolveSubscription: async () => ({ mode: 'legacy', identityOrigin: url, feedUrl: url, title: model.channel.title }) });
  return pollSubscription(result.store, result.subscription.id, { ...ports, fetchText: async () => ({ status: 200, body: text, finalUrl: url }) }, { manual: true });
}

/** Repoint only with explicit confirmation; existing imported origins remain intact. */
export async function resolveSubscriptionAgain(store, id, url, ports = {}, { confirmIdentityChange = false } = {}) {
  const current = findSubscription(store, id);
  if (!current) return { store, ok: false, reason: 'unknown-subscription' };
  const p = defaultPorts(ports);
  let resolved;
  try { resolved = await p.resolveSubscription(url, { fetchText: p.fetchText, parseFeed: p.parseFeed }); }
  catch (error) { return { store, ok: false, reason: 'resolution-failed', error: error.message }; }
  if ((resolved.identityOrigin !== current.identityOrigin || resolved.mode !== current.mode) && !confirmIdentityChange) return { store, ok: false, reason: 'identity-change', proposed: resolved };
  const st = clone(store);
  const sub = st.subscriptions.find(s => s.id === id);
  Object.assign(sub, { mode: resolved.mode, identityOrigin: resolved.identityOrigin, manifestUrl: resolved.manifestUrl ?? null, feedUrl: resolved.feedUrl, title: resolved.title, notices: resolved.notices ?? [], etag: null, lastModified: null, lastPolledAt: null, lastIndexAt: null, backoffUntil: null, failureCount: 0, lastBackoffMs: 0 });
  return { store: st, ok: true, subscription: sub };
}
