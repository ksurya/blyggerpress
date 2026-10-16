// Private state only. Publication code must construct wire objects explicitly.
import schemas from './store-schemas.mjs';
import { createRegistry, validate } from './schema-validate.mjs';
const registry = createRegistry(schemas);
const schema = registry.get('blygpress:local-store');
export const SCHEMA_VERSION = 2;
const arrays = ['drafts', 'notes', 'feedback', 'subscriptions', 'imported', 'outboundMentions', 'inboundMentions', 'publishTargets'];

function jsonCopy(value) {
  // Reject values JSON would silently discard or change.
  const text = JSON.stringify(value, (_key, v) => {
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol' ||
        (typeof v === 'number' && !Number.isFinite(v))) throw new Error('State must contain JSON values only');
    return v;
  });
  return JSON.parse(text);
}

export function migrateStore(input) {
  const state = jsonCopy(input);
  const result = validate(state, schema, { registry });
  if (!result.valid) throw new Error(`Invalid private store: ${JSON.stringify(result.errors)}`);
  if (state.schemaVersion > SCHEMA_VERSION) throw new Error('Store is from a newer studio; preserve it and upgrade the app');
  // v1 -> v2: materialize optional collections; retain all extension fields.
  for (const key of arrays) state[key] ??= [];
  state.ranking ??= {};
  if (!Object.hasOwn(state, 'publication')) state.publication = { items: [], pins: [], events: [] };
  if (!state.publication || typeof state.publication !== 'object' || Array.isArray(state.publication) ||
      ['items', 'pins', 'events'].some(key => !Array.isArray(state.publication[key]))) {
    throw new Error('Invalid publication state');
  }
  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

export function emptyStore() { return migrateStore({ schemaVersion: 1 }); }

export function createBackup(state, now = new Date().toISOString()) {
  const portable = migrateStore(state);
  delete portable.credentials;
  return JSON.stringify({ format: 'blyggerpress-private-backup', version: 1, createdAt: now, state: portable }, null, 2);
}

export function inspectBackup(text) {
  const backup = JSON.parse(text);
  if (backup?.format !== 'blyggerpress-private-backup' || backup.version !== 1 ||
      typeof backup.createdAt !== 'string' || !Number.isFinite(Date.parse(backup.createdAt))) throw new Error('Unsupported backup');
  const state = migrateStore(backup.state);
  delete state.credentials;
  return state;
}

function checkRow(row) {
  if (row !== undefined && (!row || !Number.isSafeInteger(row.revision) || row.revision < 1)) {
    throw new Error('Invalid storage revision envelope');
  }
  return row;
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** No silent memory fallback. UI must show errors and retain unsaved edits. */
export async function openStore({ indexedDB = globalThis.indexedDB, name = 'blyggerpress-private', timeoutMs = 5000 } = {}) {
  if (!indexedDB) throw new Error('Persistent storage unavailable');
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    let expired = false;
    const fail = error => { expired = true; clearTimeout(timer); reject(error); };
    const timer = setTimeout(() => fail(new Error('Storage open timed out')), timeoutMs);
    req.onblocked = () => fail(new Error('Storage upgrade blocked; close other studio tabs'));
    req.onerror = () => fail(req.error);
    req.onupgradeneeded = () => {
      if (expired) { req.transaction.abort(); return; }
      req.result.createObjectStore('state');
    };
    req.onsuccess = () => {
      clearTimeout(timer);
      if (expired) req.result.close();
      else resolve(req.result);
    };
  });
  db.onversionchange = () => db.close();

  async function transact(mode, operation) {
    const tx = db.transaction('state', mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted'));
      tx.onerror = () => {}; // onabort supplies the durable result
    });
    try {
      const value = await operation(tx.objectStore('state'));
      await done;
      return value;
    } catch (error) {
      try { tx.abort(); } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  const read = () => transact('readonly', async store => {
    const row = checkRow(await request(store.get('library')));
    return { revision: row?.revision ?? 0, state: row ? migrateStore(row.state) : emptyStore() };
  });
  async function commit(state, expectedRevision) {
    const candidate = migrateStore(state);
    return transact('readwrite', async store => {
      const current = checkRow(await request(store.get('library')));
      if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Storage conflict; reload before saving');
      // Refuse to overwrite unreadable data, even with an explicit revision.
      if (current) migrateStore(current.state);
      const revision = expectedRevision + 1;
      await request(store.put({ revision, state: candidate }, 'library'));
      return { revision, state: jsonCopy(candidate) };
    });
  }
  try {
    // Commit migrations atomically, only after validation, preserving originals on failure.
    await transact('readwrite', async store => {
      const row = checkRow(await request(store.get('library')));
      if (row) {
        const state = migrateStore(row.state);
        if (JSON.stringify(state) !== JSON.stringify(row.state)) {
          await request(store.put({ revision: row.revision + 1, state }, 'library'));
        }
      }
    });
  } catch (error) { db.close(); throw error; }
  return {
    read, save: commit,
    backup: async () => createBackup((await read()).state),
    // Replacement is explicit; caller previews inspectBackup and confirms in UI.
    restore: (text, expectedRevision) => commit(inspectBackup(text), expectedRevision),
    close: () => db.close(),
  };
}
