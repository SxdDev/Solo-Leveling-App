// db.js — promise wrapper over IndexedDB. No dependencies (plan §2.2).
// localStorage is disqualified as the record store: ~5 MB ceiling on iOS, synchronous API,
// and it would be holding the ONLY copy of the data.

export const DB_NAME = 'solo-leveling';
export const DB_VERSION = 1;

export const SCHEMA = {
  taskTemplates: { keyPath: 'id', indexes: [['active', 'active']] },
  completions:   { keyPath: 'id', indexes: [['date', 'date'], ['templateId', 'templateId']] },
  journalEntries:{ keyPath: 'id', indexes: [['date', 'date']] },
  goals:         { keyPath: 'id', indexes: [['status', 'status']] },
  dailyQuests:   { keyPath: 'id', indexes: [['date', 'date', { unique: true }]] },
  aiReviews:     { keyPath: 'id', indexes: [['periodPeriodKey', ['period', 'periodKey'], { unique: true }]] },
};

let dbp = null;

export function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      // Migrations are additive and idempotent — safe to re-run on version bumps.
      for (const [name, spec] of Object.entries(SCHEMA)) {
        const store = db.objectStoreNames.contains(name)
          ? e.target.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: spec.keyPath });
        for (const [idxName, keyPath, opts] of spec.indexes || []) {
          if (!store.indexNames.contains(idxName)) store.createIndex(idxName, keyPath, opts || {});
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const tx = async (names, mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    result = fn(t);
    if (result && typeof result.then === 'function') {
      reject(new Error('db.tx callback must be synchronous — IndexedDB transactions auto-close'));
    }
  });
};

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

export async function get(store, id) {
  const db = await open();
  return wrap(db.transaction(store, 'readonly').objectStore(store).get(id));
}

export async function put(store, value) {
  const db = await open();
  await wrap(db.transaction(store, 'readwrite').objectStore(store).put(value));
  return value;
}

export async function putAll(store, values) {
  const db = await open();
  const t = db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  values.forEach((v) => os.put(v));
  return new Promise((res, rej) => { t.oncomplete = () => res(values); t.onerror = () => rej(t.error); });
}

export async function del(store, id) {
  const db = await open();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).delete(id));
}

export async function all(store) {
  const db = await open();
  return wrap(db.transaction(store, 'readonly').objectStore(store).getAll());
}

/** getAllByIndex(store, index, value | IDBKeyRange) */
export async function byIndex(store, index, query) {
  const db = await open();
  const os = db.transaction(store, 'readonly').objectStore(store);
  return wrap(os.index(index).getAll(query));
}

export async function clear(store) {
  const db = await open();
  return wrap(db.transaction(store, 'readwrite').objectStore(store).clear());
}

export async function clearAll() {
  for (const name of Object.keys(SCHEMA)) await clear(name);
}

export const range = {
  between: (a, b) => IDBKeyRange.bound(a, b),
  from: (a) => IDBKeyRange.lowerBound(a),
};

/** Ask Safari not to evict us under disk pressure (§2.2, R-2). Best effort. */
export async function requestPersistence() {
  if (!navigator.storage?.persist) return { supported: false, granted: false };
  const already = await navigator.storage.persisted?.();
  const granted = already || (await navigator.storage.persist());
  return { supported: true, granted };
}

export async function estimate() {
  if (!navigator.storage?.estimate) return null;
  return navigator.storage.estimate();
}

export { tx };
