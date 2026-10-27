// autosave.ts — SHADOW COPIES of the open craft (v1.13.x: "the viewer can
// keep a shadow-copy of the current craft… Forget to save? No problem… in
// the file menu, autosaves should show for the various craft, with timestamp
// behind it").
//
// Every EDITED craft gets periodic shadow copies of its doc text (the exact
// save source, so a restore reproduces what Save would have downloaded)
// keyed by the craft id — `new:<title>` for unsaved docs. Storage is
// IndexedDB `archean-autosaves` with a session-Memory fallback (the crafts.ts
// pattern, so this runs headless in tests too). The File ▸ menu lists them
// per craft with timestamps; a restore opens through the standard open
// funnel (parse → normalize → makeCtx), so history/doc/bp are all fresh.
//
// Cadence (Editor): ~20 s after the last edit while the doc is dirty, on
// every manual save, and on a visibilitychange-to-hidden. Per-craft cap:
// KEEP_PER_CRAFT newest.

export interface Autosave {
  id: string;          // `${key}#${ts}`
  key: string;         // craft id, or `new:<title>` / `local:<title>`
  label: string;       // the doc's display title when saved
  ts: number;          // epoch ms — the timestamp behind the menu row
  n: number;           // global monotonic tiebreaker (same-ms saves order right)
  bytes: number;
  text: string;        // the FULL doc text (emitDoc output = a save)
}

const STORE = 'autosaves';
const KEEP_PER_CRAFT = 12;

const mem = new Map<string, Autosave>();
let seq = 0;

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(res => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const r = indexedDB.open('archean-autosaves', 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' });
      };
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

async function allSaves(): Promise<Autosave[]> {
  const d = await db();
  const rows = d ? (await tx<Autosave[]>(d, 'readonly', s => s.getAll())) ?? [] : [];
  const merged = new Map<string, Autosave>();
  for (const a of rows) merged.set(a.id, a);
  for (const [id, a] of mem) merged.set(id, a);        // session copy wins
  return [...merged.values()].sort((x, y) => y.ts - x.ts || y.n - x.n);
}

/** The craft's autosaves, newest first. */
export async function autosavesFor(key: string): Promise<Autosave[]> {
  return (await allSaves()).filter(a => a.key === key);
}

/** Every craft's autosaves, newest first (the File-menu list). */
export async function listAutosaves(): Promise<Autosave[]> {
  return allSaves();
}

export async function countAutosaves(): Promise<number> {
  return (await allSaves()).length;
}

/** Skip when the newest shadow for this craft is byte-identical (an idle
 *  timer must not record the same text over and over). */
export async function autosave(key: string, label: string, text: string): Promise<Autosave | null> {
  const forNow = await autosavesFor(key);
  if (forNow[0]?.text === text) return null;
  const a: Autosave = {
    id: `${key}#${Date.now()}#${++seq}`, key, label,   // ts + seq: same-ms saves stay distinct
    ts: Date.now(), n: seq, bytes: new TextEncoder().encode(text).length, text,
  };
  mem.set(a.id, a);
  const d = await db();
  if (d) await tx(d, 'readwrite', s => s.put(a));
  // cap per craft (keep the newest KEEP_PER_CRAFT)
  for (const old of (await autosavesFor(key)).slice(KEEP_PER_CRAFT)) await deleteAutosave(old.id);
  return a;
}

export async function deleteAutosave(id: string): Promise<void> {
  mem.delete(id);
  const d = await db();
  if (!d) return;
  await tx(d, 'readwrite', s => s.delete(id));
}

/** After a manual SAVE the shadows matter less — keep only the newest few. */
export async function pruneAfterSave(key: string): Promise<void> {
  for (const old of (await autosavesFor(key)).slice(4)) await deleteAutosave(old.id);
}

export function autosaveTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} `
       + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
