import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSubscription, createSafeFetch, createHttpPorts, subscribe, createStore, pollSubscription, refreshSubscription, resolveSubscriptionAgain, importFeedFile } from '../src/blyg/index.mjs';
const rss = '<rss><channel><title>Old</title><item><guid>a</guid><title>Hello</title><link>https://example.com/a</link></item></channel></rss>';
const blyg = JSON.stringify({ blyg: '0.3', site: 'https://asserted.example/', title: 'Test' });
function port(routes) {
  const calls = [];
  return { calls, fetchText: async (url, opts) => { calls.push([url, opts]); return { status: 404, body: '', finalUrl: url, ...routes[url] }; } };
}

test('direct probe uses the final mount, surfaces site disagreement, and deduplicates aliases', async () => {
  const p = port({ 'https://example.com/path/blyg.json': { status: 200, body: blyg, finalUrl: 'https://moved.example/mount/blyg.json' } });
  const resolved = await resolveSubscription('https://example.com/path?q=1#x', p);
  assert.equal(resolved.identityOrigin, 'https://moved.example/mount/');
  assert.equal(resolved.notices[0].type, 'origin-disagreement');
  assert.equal(p.calls.length, 1);
  const a = await subscribe(createStore(), 'https://example.com/path', p);
  const b = await subscribe(a.store, 'https://example.com/path', p);
  assert.equal(b.alreadySubscribed, true);
});

test('feed upgrade precedes conventional mounts', async () => {
  const p = port({ 'https://example.com/feed': { status: 200, body: rss.replace('<title>Old</title>', '<blyg:manifest>https://other.example/x/blyg.json</blyg:manifest>') }, 'https://other.example/x/blyg.json': { status: 200, body: blyg } });
  assert.equal((await resolveSubscription('https://example.com/feed', p)).identityOrigin, 'https://other.example/x/');
  assert.equal(p.calls.length, 3);
});

test('rel is a base URL; only one rel hop; conventional probes keep their order', async () => {
  const p = port({ 'https://example.com/page': { status: 200, body: '<link href="/free/" rel="other blyg">' }, 'https://example.com/free/blyg.json': { status: 200, body: '<link rel="blyg" href="/loop/">' }, 'https://example.com/blyg.json': { status: 200, body: blyg } });
  assert.equal((await resolveSubscription('https://example.com/page', p)).identityOrigin, 'https://example.com/');
  assert.deepEqual(p.calls.map(([u]) => u), ['https://example.com/page/blyg.json','https://example.com/page','https://example.com/free/blyg.json','https://example.com/blyg/blyg.json','https://example.com/blyg.json']);
});

test('legacy RSS and Atom autodiscovery run after conventional probes; failure carries trail', async () => {
  const p = port({ 'https://example.com/page': { status: 200, body: '<link rel="alternate" type="application/atom+xml" href="/atom">' }, 'https://example.com/atom': { status: 200, body: '<feed><title>Atom</title><entry><id>x</id><title>X</title></entry></feed>', finalUrl: 'https://feeds.example/atom' } });
  const r = await resolveSubscription('https://example.com/page', p);
  assert.equal(r.mode, 'legacy'); assert.equal(r.feedUrl, 'https://feeds.example/atom');
  assert.equal(p.calls.at(-1)[0], 'https://example.com/atom');
  const failure = await subscribe(createStore(), 'https://example.com/nothing', port({}));
  assert.equal(failure.ok, false); assert.ok(failure.tried.length <= 6); assert.equal(failure.store.subscriptions.length, 0);
});

test('safe fetch bounds redirects, shares discovery budget, and sends validators', async () => {
  const calls = [];
  const f = createSafeFetch({ fetchImpl: async (url, opts) => { calls.push([url, opts]); return calls.length === 1 ? new Response(null, { status: 302, headers: { location: '/final' } }) : new Response(null, { status: 304, headers: { etag: 'new' } }); } });
  const r = await f('https://example.com/start', { etag: 'old', lastModified: 'date', budget: { remaining: 2 } });
  assert.equal(r.finalUrl, 'https://example.com/final'); assert.equal(r.body, '');
  assert.equal(calls[0][1].headers['If-None-Match'], 'old'); assert.equal(calls[0][1].credentials, 'omit');
  assert.match(calls[0][1].headers['User-Agent'], /BlyggerPress/);
  const redirect = createSafeFetch({ maxRedirects: 1, fetchImpl: async () => new Response(null, { status: 302, headers: { location: '/loop' } }) });
  await assert.rejects(redirect('https://example.com/'), { code: 'redirect-limit' });
  await assert.rejects(f('https://example.com/', { budget: { remaining: 0 } }), { code: 'fetch-budget' });
});

test('safe fetch rejects private destinations at every hop, oversized streams, opaque redirects and stalls', async () => {
  let count = 0;
  const f = createSafeFetch({ fetchImpl: async () => { count++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }); } });
  for (const url of ['http://localhost/', 'http://2130706433/', 'http://[::ffff:127.0.0.1]/', 'file:///tmp/a']) await assert.rejects(f(url));
  assert.equal(count, 0);
  await assert.rejects(f('https://example.com/'), { code: 'private-address' });
  await assert.rejects(createSafeFetch({ maxBytes: 2, fetchImpl: async () => new Response('four') })('https://example.com/'), { code: 'body-limit' });
  await assert.rejects(createSafeFetch({ fetchImpl: async () => ({ type: 'opaqueredirect' }) })('https://example.com/'), { code: 'cors-or-redirect' });
  await assert.rejects(createSafeFetch({ timeoutMs: 5, fetchImpl: async () => new Promise(() => {}) })('https://example.com/'));
  const c = new AbortController();
  const pending = createSafeFetch({ fetchImpl: async () => new Promise(() => {}) })('https://example.com/', { signal: c.signal });
  c.abort(); await assert.rejects(pending, { code: 'aborted' });
});

test('manual refresh, monotonic retry delay, file import and identity confirmation reuse reader state', async () => {
  const file = await importFeedFile(createStore(), { feedUrl: 'https://example.com/rss', text: rss });
  assert.equal(file.store.imported.length, 1);
  const id = file.store.subscriptions[0].id;
  const at = '2026-10-16T00:00:00.000Z';
  const ports = { now: () => at, fetchText: async () => ({ status: 429, retryAfter: '3600' }) };
  const fail = await pollSubscription(file.store, id, ports);
  const again = await refreshSubscription(fail.store, id, { ...ports, fetchText: async () => ({ status: 503, retryAfter: '1' }) });
  assert.equal(again.store.subscriptions[0].lastBackoffMs, 3600000);
  assert.deepEqual(again.store.imported, file.store.imported);
  const redirect = await refreshSubscription(file.store, id, { fetchText: async () => ({ status: 200, body: rss, finalUrl: 'https://other.example/rss' }) });
  assert.equal(redirect.reason, 'identity-change'); assert.deepEqual(redirect.store.imported, file.store.imported);
  const resolved = { mode: 'legacy', identityOrigin: 'https://other.example/rss', feedUrl: 'https://other.example/rss' };
  const p = { resolveSubscription: async () => resolved };
  const proposed = await resolveSubscriptionAgain(file.store, id, resolved.feedUrl, p);
  assert.equal(proposed.reason, 'identity-change'); assert.equal(proposed.store, file.store);
  const adopted = await resolveSubscriptionAgain(file.store, id, resolved.feedUrl, p, { confirmIdentityChange: true });
  assert.equal(adopted.subscription.identityOrigin, resolved.identityOrigin); assert.deepEqual(adopted.store.imported, file.store.imported);
  const malformed = await refreshSubscription(file.store, id, { fetchText: async () => ({ status: 200, body: 'bad' }) });
  assert.equal(malformed.ok, false);
});

test('committed sample discovery uses production ports and the normalized feed contract', async () => {
  const manifest = readFileSync(new URL('../fixtures/wire/sample-blyg/blyg.json', import.meta.url), 'utf8');
  const p = createHttpPorts({ fetchImpl: async () => new Response(manifest) });
  const r = await subscribe(createStore(), 'https://example.com/blyg/', p);
  assert.equal(r.subscription.identityOrigin, 'https://example.com/blyg/');
});
