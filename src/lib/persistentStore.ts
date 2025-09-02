// Lightweight IndexedDB-backed persistence with localStorage fallback and two-phase commits.
// Stores 3 keys in IDB: staging, current, backup. Falls back to localStorage 'semanticGraph'.
// Save flow: write staging -> verify -> copy current to backup -> promote staging to current -> delete staging.
// Load flow: current -> backup -> legacy localStorage -> null.

export type GraphSnapshot = any; // SemanticGraph.toJSON() shape

const DB_NAME = 'thinkcraft-db';
const STORE = 'graph';
const KEYS = { CURRENT: 'current', BACKUP: 'backup', STAGING: 'staging' } as const;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const os = tx.objectStore(STORE);
      const rq = os.get(key);
      rq.onsuccess = () => resolve((rq.result as T) ?? null);
      rq.onerror = () => reject(rq.error);
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const rq = os.put(value as any, key);
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error);
  });
}

async function idbDel(key: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const rq = os.delete(key);
    rq.onsuccess = () => resolve();
    rq.onerror = () => reject(rq.error);
  });
}

function lsGet(): GraphSnapshot | null {
  try {
    return JSON.parse(localStorage.getItem('semanticGraph') || 'null');
  } catch {
    return null;
  }
}
function lsSet(json: GraphSnapshot) {
  try {
    localStorage.setItem('semanticGraph', JSON.stringify(json));
  } catch {
    // ignore quota/serialization errors
  }
}

export const PersistentStore = {
  /** Load with recovery: current -> backup -> localStorage -> null */
  async load(): Promise<GraphSnapshot | null> {
    const cur = await idbGet<GraphSnapshot>(KEYS.CURRENT);
    if (cur) return cur;
    const bak = await idbGet<GraphSnapshot>(KEYS.BACKUP);
    if (bak) return bak;
    const ls = lsGet();
    return ls;
  },

  /** Two-phase commit + backup; fallback to localStorage on IDB error */
  async save(json: GraphSnapshot): Promise<void> {
    try {
      await idbSet(KEYS.STAGING, json);
      const roundTrip = await idbGet<GraphSnapshot>(KEYS.STAGING);
      if (!roundTrip) throw new Error('Staging readback failed');
      // Keep previous current as backup (if exists)
      const prevCurrent = await idbGet<GraphSnapshot>(KEYS.CURRENT);
      await idbSet(KEYS.BACKUP, prevCurrent ?? json);
      await idbSet(KEYS.CURRENT, json);
      await idbDel(KEYS.STAGING);
    } catch {
      // Graceful fallback to legacy localStorage
      lsSet(json);
    }
  },

  /** Clear all persisted data (IDB + legacy localStorage) */
  async clearAll(): Promise<void> {
    try {
      await idbDel(KEYS.CURRENT);
      await idbDel(KEYS.BACKUP);
      await idbDel(KEYS.STAGING);
    } catch {}
    localStorage.removeItem('semanticGraph');
  }
};
