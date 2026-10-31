// xenonstore.ts — THE STORAGE PERSISTENCE LAW (v1.16.27, we: "I tried the
// chipOS devkt, but all screens say to use the primary one and I cannot get
// it to work. I suspect something is wrong there"): `storage var` is the
// program's PERSISTENT storage — the game keeps it beside the save, so a
// setup you completed stays completed. Our VMs run on the wasm in-memory
// filesystem, which DIES with the page: ChipOS re-ran its first-run wizard
// on every single load and every board showed the placeholder. The pump now
// (a) restores the map into the fresh VM BEFORE boot (shim ABI 19
// xc_seed_storage — LoadStorage then finds last session's values) and
// (b) persists the live cache back (xc_storage_dump) on a ~2 s throttle,
// on stop, on reboot and on close. Opaque JSON {name: [lines]} — the app
// never interprets it. IndexedDB per (craft, computer), the crafts.ts
// pattern; a memory map stands in where IDB is absent (node/vitest).
export type XenonStore = Record<string, string[]>;

export const storageKey = (craft: string, ci: number) => `${craft}#${ci}`;

const mem = new Map<string, XenonStore>();   // IDB-less fallback
const DB_NAME = 'xenon-storage', DB_VERSION = 1, OS = 'kv';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(res => {
    if (typeof indexedDB === 'undefined') return res(null);
    let done = false;
    const fin = (v: IDBDatabase | null) => { if (!done) { done = true; res(v); } };
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains(OS)) db.createObjectStore(OS);
    };
    rq.onsuccess = () => fin(rq.result);
    rq.onerror = () => fin(null);
    setTimeout(() => fin(null), 1500);       // a locked DB must never hang a boot
  });
}
let dbP: Promise<IDBDatabase | null> | null = null;

async function idb<T>(mode: IDBTransactionMode,
  f: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  // THE CONNECTION STAYS OPEN (v1.16.27 catch): dbP caches the resolved DB —
  // closing it after every request poisoned the cache (the second call's
  // db.transaction threw InvalidStateError into the silent catch and the
  // pump persisted NOTHING after loadStore's first read). One connection
  // for the page's life is the IDB idiom; the OS reclaims it with the page.
  dbP ??= openDb();
  const db = await dbP;
  if (!db) { dbP = null; return null; }   // a locked/failed open is retried next call
  return new Promise(res => {
    try {
      const tx = db.transaction(OS, mode);
      const rq = f(tx.objectStore(OS));
      rq.onsuccess = () => res(rq.result as T ?? null);
      rq.onerror = () => res(null);
      tx.onabort = () => res(null);
    } catch { res(null); }
  });
}

/** last session's storage for one computer, or null (a genuinely fresh disk) */
export async function loadStore(key: string): Promise<XenonStore | null> {
  const hit = await idb<{ v: XenonStore }>('readonly', s => s.get(key));
  if (hit?.v) { mem.set(key, hit.v); return hit.v; }
  return mem.get(key) ?? null;
}

/** persist the current cache (an EMPTY map is real state too — a wiped disk) */
export async function saveStore(key: string, store: XenonStore): Promise<void> {
  mem.set(key, store);
  await idb('readwrite', s => s.put({ v: store }, key));
}
