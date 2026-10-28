// crafts.ts — craft blueprints: download ONLY when required, with byte
// progress for the download overlay, cached in IndexedDB — and VALIDATED.
//
// Policy (the user's rule): the gallery is the statically compiled catalog
// (virtual:gallery — AGENTS § Blueprint folder), so blueprint.json is fetched
// ONLY when a craft is opened and it is NOT in the cache. A FRESH cached
// craft opens with ZERO network requests; the File-menu refresh (force) is
// the only other path to the network. Progress arrives per streamed chunk:
// (frac 0..1 | null when the server sent no Content-Length, bytes).
//
// VERSIONED CACHE (v1.9.5): every catalog entry carries the file's `rev`
// ('<bytes>-<mtimeMs>') and SHA-256 (app/tools/vite-corpus.ts § VERSIONED
// CACHE); the /corpus route repeats both as X-Blueprint-Rev / X-Blueprint-Sha
// response headers. A stored entry stamps the rev it was downloaded at and,
// when the digest verified, the sha of the stored text. craftState() then
// classifies a craft:
//   fresh    rev matches the catalog AND (if a sha was captured) the stored
//            sha matches the stored text — provably the file as served
//   stale    rev differs — the file was edited after caching
//   unknown  legacy (v1) entry / unverified download / sha mismatch —
//            NEVER silently trusted, always warned
//   absent   not in the cache
// A download whose bytes fail the digest check IS handed to the session (the
// craft still opens) but stored WITHOUT rev/sha, so it reads 'unknown' from
// then on — with a console diagnostic. The UI turns stale/unknown into an
// explicit [Download latest] / [Open cached copy] choice (Editor open gate +
// gallery chips): nothing is used or replaced silently.
//
// IndexedDB is wrapped best-effort: private mode / unsupported browsers
// degrade to a session Map, and a storage failure NEVER blocks opening.
// DB VERSION 2: entries gained {rev, sha, bytes, mtime}. The object-store
// schema is unchanged, so v1 data survives the upgrade untouched; a v1 entry
// simply carries no rev → craftState() reports 'unknown' (warn, never trust).
//
// catalog data reaches this module ONLY through arguments (CraftMeta) — no
// React, no virtual-module imports live here.

export interface CraftLoad { text: string; fromCache: boolean; bytes: number }
export type ProgressFn = (frac: number | null, bytes: number) => void

/** the catalog's knowledge about a craft's file (a GalleryEntry subset —
 *  gallery-catalog.craftMeta() produces it from virtual:gallery) */
export interface CraftMeta { rev?: string; sha?: string; bytes?: number; mtime?: number }

export type CraftState = 'fresh' | 'stale' | 'unknown' | 'absent';

const DB_NAME = 'archean-crafts';
const STORE = 'blueprints';
const DB_VERSION = 2;
const MAX_CACHED = 150;                      // blueprints are 1 kB..1 MB

interface Entry {
  text: string;
  saved: number;                             // when THIS copy was cached (ms)
  rev?: string;                              // '<bytes>-<mtimeMs>' at download; ABSENT = legacy/unverified
  sha?: string;                              // verified SHA-256 of text; ABSENT = never verified
  bytes?: number;                            // UTF-8 byte length of text
  mtime?: number;                            // file mtime the rev describes (from the catalog)
}
/** an Entry minus its payload — cheap to hand to the gallery chips / dialog */
export type CacheInfo = Omit<Entry, 'text'>;

const mem = new Map<string, Entry>();        // IDB-less fallback

// ---------------------------------------------------------------- SHA-256
// crypto.subtle where available; below it a compact PURE-JS SHA-256
// (FIPS 180-4) fallback, because the primary use of this app is served over
// PLAIN HTTP on the LAN (Tailscale dev server) — a non-secure context where
// browsers expose NO crypto.subtle. Both paths are pinned against node's
// crypto in __tests__/crafts.test.ts. null = could not hash (then nothing is
// "verified": the entry stores no sha and stays 'unknown'-eligible).

export async function sha256Hex(text: string): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const buf = await subtle.digest('SHA-256', new TextEncoder().encode(text));
      let out = '';
      for (const b of new Uint8Array(buf)) out += b.toString(16).padStart(2, '0');
      return out;
    }
  } catch { /* fall through to the JS twin */ }
  try { return sha256HexSync(text); } catch { return null; }
}

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** the pure-JS SHA-256 (also the crypto.subtle-less fallback) — exported so
 *  the unit pins can exercise the fallback path directly on node. */
export function sha256HexSync(text: string): string {
  const msg = new TextEncoder().encode(text);
  const bitLen = msg.length * 8;
  const blocks = Math.ceil((msg.length + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(buf.length - 4, bitLen >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!, y = w[i - 2]!;
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + SHA_K[i]! + w[i]!) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(x => x.toString(16).padStart(8, '0')).join('');
}

// ---------------------------------------------------------------- storage
function openDb(): Promise<IDBDatabase | null> {
  return new Promise(res => {
    try {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      // v1 → v2 adds OPTIONAL entry fields only — no schema change, existing
      // entries survive; they simply lack .rev (→ craftState 'unknown').
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

const infoOf = (e: Entry): CacheInfo =>
  ({ saved: e.saved, rev: e.rev, sha: e.sha, bytes: e.bytes, mtime: e.mtime });

/** for tests / diagnostics */
export async function craftCached(id: string): Promise<boolean> {
  return (await idbGet(id)) !== null;
}
export async function clearCraftCache(): Promise<void> {
  mem.clear();
  const d = await db();
  if (d) await tx(d, 'readwrite', s => s.clear());
}

/** the cache record for one craft WITHOUT its payload (dialog dates, chips) */
export async function craftInfo(id: string): Promise<CacheInfo | null> {
  const e = await idbGet(id);
  return e ? infoOf(e) : null;
}

/** ONE pass over the whole cache (id + metadata, no texts kept) — the gallery
 *  paints every card's status chip from this single snapshot. */
export async function cacheSnapshot(): Promise<Map<string, CacheInfo>> {
  const out = new Map<string, CacheInfo>();
  const d = await db();
  if (d) {
    const [vals, keys] = await Promise.all([
      tx<Entry[]>(d, 'readonly', s => s.getAll()),
      tx<string[]>(d, 'readonly', s => s.getAllKeys()),
    ]);
    if (vals && keys) vals.forEach((e, i) => {
      const k = keys[i];
      if (k != null && e) out.set(k, infoOf(e));
    });
  }
  for (const [k, e] of mem) out.set(k, infoOf(e));   // session copy is freshest
  return out;
}

// ---------------------------------------------------------------- states
/** PURE classification of one cache record against the catalog meta (the
 *  gallery runs this over its whole cacheSnapshot; craftState adds the async
 *  sha-vs-stored-text self-check on top).
 *  v1.13.11 LAW (we: "it always thinks it changed when I made a new release;
 *  this should check whether the actual SHA of the file itself is different!
 *  not the release"): identity is the CONTENT SHA only. The old rev
 *  (bytes-mtime) verdicts made every release re-stamp every card — the
 *  Pages build checks the tree out fresh, so git hands every file a new
 *  mtime and rev churns while the bytes are identical. mtime/bytes stay as
 *  DISPLAY metadata (the tooltip dates), never as the trust decision. */
export function craftStateOf(e: CacheInfo | null | undefined, meta?: CraftMeta): CraftState {
  if (!e) return 'absent';
  if (!e.sha) return 'unknown';              // legacy v1 entry / unverified download
  if (!meta?.sha) return 'unknown';          // nothing to validate against — never silently trust
  return e.sha === meta.sha ? 'fresh' : 'stale';
}

/** the state the UI gates on: absent → download; fresh → open (zero network);
 *  stale / unknown → the [Download latest] / [Open cached copy] dialog. */
export async function craftState(id: string, meta?: CraftMeta): Promise<CraftState> {
  const e = await idbGet(id);
  if (!e) return 'absent';
  const st = craftStateOf(infoOf(e), meta);
  if (st !== 'fresh') return st;
  if (e.sha) {
    // "fresh" also means the stored bytes still hash to the stored digest —
    // a corrupted record must never read as trusted.
    const local = await sha256Hex(e.text);
    if (local !== e.sha) {
      console.warn(`[crafts] ${id}: stored text no longer matches its SHA-256 ` +
        `(${local ?? 'unhashable'} vs ${e.sha}) — treating the copy as unversioned.`);
      return 'unknown';
    }
  }
  return 'fresh';
}

// ---------------------------------------------------------------- download
/** streamed GET with per-chunk byte progress. Returns null on HTTP failure.
 *  fetchImpl is injectable for the node unit tests; onMeta receives the
 *  response headers (the download path reads X-Blueprint-Sha/Rev from them). */
export async function fetchProgress(url: string, onProgress: ProgressFn,
  fetchImpl: typeof fetch = fetch, onMeta?: (h: Headers) => void): Promise<string | null> {
  let res: Response;
  try { res = await fetchImpl(url); } catch { return null; }
  if (!res.ok) return null;
  onMeta?.(res.headers);
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
 *  progress, VERIFY the bytes against the published digest and store the
 *  copy stamped with {rev, sha, bytes, mtime}. null = could not load (and
 *  none cached). The state gate itself lives in the UI (craftState above):
 *  a cache hit is returned as-is here, so the user's [Open cached copy]
 *  choice works for stale/unknown entries too. meta = the catalog's stamp
 *  for this id (gallery-catalog.craftMeta) — used to stamp the download when
 *  the response carries no headers (static Pages layout) and to verify. */
export function loadCraft(id: string, onProgress: ProgressFn,
  force = false, fetchImpl: typeof fetch = fetch, meta?: CraftMeta): Promise<CraftLoad | null> {
  const key = force ? `${id}!force` : id;
  const busy = active.get(key);
  if (busy) { busy.subs.add(onProgress); return busy.p; }
  const subs = new Set<ProgressFn>([onProgress]);
  const notify: ProgressFn = (f, b) => { for (const fn of [...subs]) fn(f, b); };
  const d: Download = { subs, p: null as unknown as Promise<CraftLoad | null> };
  d.p = (async (): Promise<CraftLoad | null> => {
    if (!force) {
      const hit = await idbGet(id);
      if (hit) return { text: hit.text, fromCache: true, bytes: hit.bytes ?? hit.text.length };  // no progress: nothing downloads
    }
    notify(null, 0);                                         // download STARTED: overlay appears
    // candidate routes, LAYOUT-EXACT-FIRST (the v1.5.6 atlas lesson, applied
    // to the blueprint route in v1.12.2 — the live Pages audit caught a
    // guaranteed 404 per fresh craft: /corpus/ leads, Pages 404s it, then
    // the static route hits): testdata/ = the STATIC GitHub Pages layout
    // where the app IS the site root (tools/deploy_pages.py ships dist at
    // the repo root) and the dev/preview server serves the same page-
    // relative /testdata route through the corpus plugin (X-Blueprint-Sha
    // rides there too); ../testdata/ = the same site served one level
    // deeper (/app/); /corpus/ = the dev/preview alias, kept LAST as the
    // machine-local fallback. First hit wins.
    let text: string | null = null;
    const got = { hdr: null as Headers | null };   // holder: closure-assigned
    for (const url of [`testdata/${id}/blueprint.json`, `../testdata/${id}/blueprint.json`,
                       `/corpus/${id}/blueprint.json`]) {
      got.hdr = null;
      text = await fetchProgress(url, notify, fetchImpl, h => { got.hdr = h; });
      if (text != null) break;
    }
    if (text == null) return null;
    // ---- verify + stamp (the versioned-cache contract) --------------------
    const bytes = new TextEncoder().encode(text).length;
    const hdrSha = (got.hdr?.get('x-blueprint-sha') ?? '').trim().toLowerCase();
    const hdrRev = (got.hdr?.get('x-blueprint-rev') ?? '').trim();
    // expected digest: the server header first, else the catalog's (the
    // static Pages layout sends no headers but the catalog was compiled from
    // the very same file at deploy time)
    const wantSha = hdrSha || (meta?.sha ?? '').trim().toLowerCase();
    const localSha = await sha256Hex(text);
    const entry: Entry = { text, saved: Date.now(), bytes, mtime: meta?.mtime ?? 0 };
    if (wantSha && localSha && wantSha !== localSha) {
      // The bytes are NOT what the digest was published for. Hand them to
      // the session (this open still works), but store them UNTRUSTED:
      // no rev, no sha → craftState() = 'unknown' → warned on every later
      // open, never silently served.
      console.warn(`[crafts] ${id}: SHA-256 MISMATCH for ${hdrRev || meta?.rev || '?'} — ` +
        `published ${wantSha}, computed ${localSha}. The copy is kept UNTRUSTED (open will warn).`);
    } else {
      const rev = hdrRev || meta?.rev;
      if (rev) entry.rev = rev;
      if (wantSha && localSha) entry.sha = localSha;
    }
    await idbPut(id, entry);
    return { text, fromCache: false, bytes };
  })().finally(() => active.delete(key));
  active.set(key, d);
  return d.p;
}
