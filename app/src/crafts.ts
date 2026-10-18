// crafts.ts — craft blueprints: download ONLY when required, with byte
// progress for the download overlay, cached in IndexedDB.
//
// Policy (the user's rule): the gallery is the statically compiled catalog
// (virtual:gallery — AGENTS § Blueprint folder), so blueprint.json is fetched
// ONLY when a craft is opened and it is NOT in the cache. A cached craft
// opens with ZERO network requests; the File-menu refresh (force) is the
// only other path to the network. Progress arrives per streamed chunk:
// (frac 0..1 | null when the server sent no Content-Length, bytes).
//
// IndexedDB is wrapped best-effort: private mode / unsupported browsers
// degrade to a session Map, and a storage failure NEVER blocks opening.

export interface CraftLoad { text: string; fromCache: boolean; bytes: number }
export type ProgressFn = (frac: number | null, bytes: number) => void

const DB_NAME = 'archean-crafts';
const STORE = 'blueprints';
const MAX_CACHED = 150;                      // blueprints are 1 kB..1 MB

interface Entry { text: string; saved: number }

const mem = new Map<string, Entry>();        // IDB-less fallback

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(res => {
    try {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}
let dbP: Promise<IDBDatabase | null> | null = null;
const db = () => (dbP ??= openDb());

function tx<T>(d: IDBDatabase, mode: IDBTransactionMode,
  f: (s: IDBObjectStore) => IDBRequest): Promise<T | null> {
  return new Promise(res => {
    try {
      const r = f(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => res(r.result as T);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
}

async function idbGet(id: string): Promise<Entry | null> {
  const d = await db();
  if (!d) return mem.get(id) ?? null;
  return (await tx<Entry>(d, 'readonly', s => s.get(id))) ?? mem.get(id) ?? null;
}

async function idbPut(id: string, e: Entry): Promise<void> {
  mem.set(id, e);                            // session copy always
  const d = await db();
  if (!d) return;
  await tx(d, 'readwrite', s => s.put(e, id));
  // rough LRU cap: the corpus holds thousands of workshop crafts
  const all = await tx<Entry[]>(d, 'readonly', s => s.getAll());
  if (all && all.length > MAX_CACHED) {
    const dead = all.map((v, i) => ({ v: v.saved, i })).sort((a, b) => a.v - b.v)
      .slice(0, all.length - MAX_CACHED).map(x => x.i);
    const old = await tx<string[]>(d, 'readonly', s => s.getAllKeys());
    for (const i of dead) if (old?.[i]) await tx(d, 'readwrite', s => s.delete(old[i]!));
  }
}

/** for tests / diagnostics */
export async function craftCached(id: string): Promise<boolean> {
  return (await idbGet(id)) !== null;
}
export async function clearCraftCache(): Promise<void> {
  mem.clear();
  const d = await db();
  if (d) await tx(d, 'readwrite', s => s.clear());
}

/** streamed GET with per-chunk byte progress. Returns null on HTTP failure.
 *  fetchImpl is injectable for the node unit tests. */
export async function fetchProgress(url: string, onProgress: ProgressFn,
  fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let res: Response;
  try { res = await fetchImpl(url); } catch { return null; }
  if (!res.ok) return null;
  const len = Number(res.headers.get('content-length'));
  if (!res.body || !Number.isFinite(len) || len <= 0) {       // unlengthed: one blob
    const text = await res.text();
    onProgress(1, text.length);
    return text;
  }
  const rd = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let lastFrac = 0;
  for (;;) {
    const r = await rd.read();
    if (r.done) break;
    chunks.push(r.value);
    got += r.value.byteLength;
    lastFrac = Math.min(1, got / len);
    onProgress(lastFrac, got);
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  const text = new TextDecoder().decode(all);
  if (lastFrac !== 1) onProgress(1, got);     // only when the stream lied about length
  return text;
}

/** in-flight downloads, deduped: concurrent opens of the same craft SHARE
 *  one fetch (React StrictMode dev double-mount, retry during a slow
 *  download, double clicks) — progress fans out to every listener. */
interface Download { subs: Set<ProgressFn>; p: Promise<CraftLoad | null> }
const active = new Map<string, Download>();

/** open ONE craft: cache-first unless force; on a miss download with
 *  progress and store the copy. null = could not load (and none cached). */
export function loadCraft(id: string, onProgress: ProgressFn,
  force = false, fetchImpl: typeof fetch = fetch): Promise<CraftLoad | null> {
  const key = force ? `${id}!force` : id;
  const busy = active.get(key);
  if (busy) { busy.subs.add(onProgress); return busy.p; }
  const subs = new Set<ProgressFn>([onProgress]);
  const notify: ProgressFn = (f, b) => { for (const fn of [...subs]) fn(f, b); };
  const d: Download = { subs, p: null as unknown as Promise<CraftLoad | null> };
  d.p = (async (): Promise<CraftLoad | null> => {
    if (!force) {
      const hit = await idbGet(id);
      if (hit) return { text: hit.text, fromCache: true, bytes: hit.text.length };  // no progress: nothing downloads
    }
    notify(null, 0);                                         // download STARTED: overlay appears
    const text = await fetchProgress(`/corpus/${id}/blueprint.json`, notify, fetchImpl);
    if (text == null) return null;
    await idbPut(id, { text, saved: Date.now() });
    return { text, fromCache: false, bytes: text.length };
  })().finally(() => active.delete(key));
  active.set(key, d);
  return d.p;
}
