import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { openStore, emptyStore, migrateStore, createBackup, inspectBackup } from '../src/studio/store.mjs';
import schemas from '../src/studio/store-schemas.mjs';
const fixture = JSON.parse(readFileSync(new URL('../fixtures/store/sample-store.json', import.meta.url)));
const open = (indexedDB = new IDBFactory()) => openStore({ indexedDB });

test('runtime schemas exactly match shared contracts', () => {
  for (const { id, schema } of schemas) {
    assert.deepEqual(schema, JSON.parse(readFileSync(new URL(`../contracts/schemas/${id.split(':')[1]}.schema.json`, import.meta.url))));
  }
});

test('migrates v1 without changing source or private extensions; rejects invalid/future data', () => {
  const before = structuredClone(fixture);
  const state = migrateStore(fixture);
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.drafts, fixture.drafts);
  assert.deepEqual(fixture, before);
  assert.deepEqual(migrateStore(state), state);
  for (const value of [{}, { schemaVersion: 3 }, { ...fixture, notes: [{}] }, { ...fixture, drafts: null }, { ...fixture, publication: [] }]) {
    assert.throws(() => migrateStore(value));
  }
  assert.throws(() => migrateStore({ schemaVersion: 1, ranking: { weight: NaN } }));
});

test('reload persists all private domains and publication history; backup round trips sans credentials', async () => {
  const idb = new IDBFactory();
  let store = await open(idb);
  const state = migrateStore(fixture);
  state.publication = { items: [{ id: 'own', version: 2 }], pins: [{ id: 'own', version: 1 }], events: [{ version: 2 }] };
  await store.save(state, 0);
  store.close();
  store = await open(idb);
  assert.deepEqual((await store.read()).state, state);
  const backup = await store.backup();
  assert.equal(backup.includes('credentials'), false);
  const other = await open();
  await other.restore(backup, 0);
  const expected = structuredClone(state);
  delete expected.credentials;
  assert.deepEqual((await other.read()).state, expected);
  assert.equal(expected.notes[0].text, 'PRIVATE-NOTE-SECRET');
  store.close(); other.close();
});

test('atomic saves reject stale tabs and invalid restores, retaining prior state', async () => {
  const idb = new IDBFactory();
  const a = await open(idb), b = await open(idb);
  const snapshot = await a.read();
  const results = await Promise.allSettled([a.save(fixture, snapshot.revision), b.save(emptyStore(), snapshot.revision)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const before = await a.read();
  for (const bad of ['{', '{}', createBackup(emptyStore()).replace('"schemaVersion": 2', '"schemaVersion": 99')]) {
    await assert.rejects(async () => a.restore(bad, before.revision));
    assert.deepEqual(await a.read(), before);
  }
  const detached = await a.read();
  detached.state.notes.push({});
  assert.deepEqual(await a.read(), before);
  a.close(); b.close();
});

async function seed(idb, state) {
  const db = await new Promise((resolve, reject) => {
    const req = idb.open('blyggerpress-private', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('state');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put({ revision: 7, state }, 'library');
    tx.oncomplete = resolve; tx.onabort = reject;
  });
  db.close();
}

test('stored v1 migrates once and failed migration preserves raw bytes', async () => {
  const idb = new IDBFactory();
  await seed(idb, fixture);
  let store = await open(idb);
  assert.equal((await store.read()).revision, 8);
  store.close(); store = await open(idb);
  assert.equal((await store.read()).revision, 8);
  store.close();
  for (const invalid of [{ schemaVersion: 99 }, { schemaVersion: 1, subscriptions: [{}] }]) {
    const broken = new IDBFactory();
    await seed(broken, invalid);
    await assert.rejects(open(broken));
    const db = await new Promise(resolve => { const req = broken.open('blyggerpress-private'); req.onsuccess = () => resolve(req.result); });
    const row = await new Promise(resolve => { const req = db.transaction('state').objectStore('state').get('library'); req.onsuccess = () => resolve(req.result); });
    assert.deepEqual(row, { revision: 7, state: invalid });
    db.close();
  }
});

test('unavailable or denied storage fails visibly', async () => {
  await assert.rejects(openStore({ indexedDB: null }), /unavailable/);
  await assert.rejects(openStore({ indexedDB: { open() { throw new Error('denied'); } } }), /denied/);
});

test('backup parser excludes supplied credential metadata', () => {
  const backup = JSON.parse(createBackup(fixture));
  backup.state.credentials = fixture.credentials;
  assert.equal('credentials' in inspectBackup(JSON.stringify(backup)), false);
});

test('reader importer state survives save, reload and portable restore', async () => {
  const { subscribe, pollSubscription } = await import('../src/blyg/importer.mjs');
  const { createFixturePorts, blygResolver, ORIGIN, NOW } = await import('./helpers/fixture-ports.mjs');
  const ports = { ...createFixturePorts({ mount: ORIGIN, dir: 'sample-blyg', now: NOW }), resolveSubscription: blygResolver() };
  const subscription = await subscribe(emptyStore(), ORIGIN, ports);
  const result = await pollSubscription(subscription.store, subscription.store.subscriptions[0].id, ports);
  const store = await open();
  await store.save(result.store, 0);
  assert.deepEqual(inspectBackup(await store.backup()), (await store.read()).state);
  store.close();
});

test('blocked opens fail promptly and abort late upgrades', async () => {
  const idb = new IDBFactory();
  const blocker = await new Promise(resolve => {
    const req = idb.open('blyggerpress-private', 1);
    req.onsuccess = () => resolve(req.result);
  });
  // Block a higher DB version using a minimal proxy around the factory.
  const proxy = { open(name) { return idb.open(name, 2); } };
  await assert.rejects(openStore({ indexedDB: proxy }), /blocked/);
  blocker.close();
  await new Promise(resolve => setTimeout(resolve, 10));
  const db = await new Promise(resolve => { const req = idb.open('blyggerpress-private'); req.onsuccess = () => resolve(req.result); });
  assert.equal(db.version, 1, 'late rejected upgrade was aborted');
  db.close();
});

test('failed write aborts transaction and retains the last durable snapshot', async () => {
  const { IDBObjectStore } = await import('fake-indexeddb');
  const store = await open();
  await store.save(fixture, 0);
  const before = await store.read();
  const put = IDBObjectStore.prototype.put;
  try {
    IDBObjectStore.prototype.put = function () { throw new DOMException('Disk quota exhausted', 'QuotaExceededError'); };
    await assert.rejects(store.save(emptyStore(), before.revision), { name: 'QuotaExceededError' });
  } finally {
    IDBObjectStore.prototype.put = put;
  }
  assert.deepEqual(await store.read(), before);
  store.close();
});

test('timed-out queued opens abort their late upgrades', async () => {
  let pending;
  let aborted = false;
  const indexedDB = { open() { pending = {}; return pending; } };
  await assert.rejects(openStore({ indexedDB, timeoutMs: 5 }), /timed out/);
  pending.transaction = { abort() { aborted = true; } };
  pending.onupgradeneeded();
  assert.equal(aborted, true);
});
