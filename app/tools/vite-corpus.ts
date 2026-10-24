// vite-corpus.ts — blueprint corpus serving + statically compiled gallery.
// Implements AGENTS.md § Blueprint folder for the app: the corpus root comes
// from env ARCHEAN_BLUEPRINTS > repo-root blueprints.conf > <repo>/testdata —
// NEVER a hardcoded path. Mirrors tools/config.py's resolution.
//
//  /corpus/                      → directory listing (<a href="<id>/">)
//  /corpus/<id>/blueprint.json   → the file (revalidate)
//  /corpus/<id>/preview.jpg      → thumbnail (cached 1 h)
//  virtual:gallery               → STATICALLY COMPILED catalog: entries are
//      baked into the bundle at build time (dev: watched + invalidated), so
//      the gallery paints with zero runtime fetches. Rebuild after moving
//      the corpus (npm run serve) — that is the point of compiling it in.
//      Since the v1.9.5 VERSIONED CACHE every entry also carries
//      {rev, sha, bytes, mtime} of its blueprint.json — the SAME stamp the
//      /corpus route publishes as X-Blueprint-Rev / X-Blueprint-Sha, so the
//      app's IndexedDB cache can prove which revision it holds (crafts.ts).
//      The catalog is the UNION of the configured corpus over the repo
//      testdata fixture floor (a Steam client/blueprints folder carries only
//      the craft the player touched in-game — the V1 landing catalog lived on
//      the full corpus), minus the SYNTH/matrix fixtures + V1's EXCLUDE set,
//      with make_landing.py's name table + numeric-name skip, so the app
//      gallery shows the SAME workshop catalog as the landing page — never
//      the individual-component test cases (user report 2026-10-19).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginOption, PreviewServer, ViteDevServer } from 'vite';

const REPO = path.resolve(import.meta.dirname, '..', '..');

export interface GalleryEntry { id: string; name: string; author?: string; preview: string | null;
  /** version tag of the served blueprint.json: '<bytes>-<mtimeMs>' (crafts.ts validates against it) */
  rev: string;
  /** hex SHA-256 of the blueprint.json bytes as served ('' only when unreadable) */
  sha: string;
  /** blueprint.json size in bytes */
  bytes: number;
  /** blueprint.json mtime (ms since epoch) — the "file changed <date>" of the staleness chip */
  mtime: number }

function expandUser(p: string): string {
  return p.startsWith('~') ? path.join(process.env.HOME ?? '', p.slice(2)) : p;
}

/** env > blueprints.conf > <repo>/testdata (relative entries resolve vs repo).
 *  Memoised: the hot path (every image request) must not re-read the conf. */
let corpusCache: string | null = null;
export function corpusDir(): string {
  if (corpusCache) return corpusCache;
  let raw = process.env.ARCHEAN_BLUEPRINTS;
  if (!raw) {
    const conf = path.join(REPO, 'blueprints.conf');
    if (fs.existsSync(conf)) {
      for (const line of fs.readFileSync(conf, 'utf8').split('\n')) {
        const s = line.split('#')[0]!;
        const eq = s.indexOf('=');
        if (eq < 0) continue;
        if (s.slice(0, eq).trim().toLowerCase() === 'blueprints') {
          raw = s.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
          break;
        }
      }
    }
  }
  raw = raw || path.join(REPO, 'testdata');
  return (corpusCache = path.resolve(REPO, expandUser(raw)));
}

/** Per-craft folder: the configured corpus first, the repo testdata as the
 *  fixture floor. A custom corpus (Steam saves) is a superset the user curates
 *  — it need not carry the regression fixtures (XYQ 3803780241, the giant
 *  3509975859 …), which the repo's testdata/ always ships. Test ids and
 *  gallery deep links therefore resolve on ANY machine — still zero
 *  hardcoded absolute paths (AGENTS § Blueprint folder). */
export function craftRoot(id: string): string {
  const p = path.join(corpusDir(), id);
  return fs.existsSync(path.join(p, 'blueprint.json')) ? p : path.join(REPO, 'testdata', id);
}

/** corpus-rooted file lookup with the same fixture floor (node-side tests).
 *  PER-FILE fallback: a Steam corpus craft may carry blueprint.json but no
 *  preview.jpg — the testdata copy of that file then serves (v0.181). */
export function craftFile(id: string, file = 'blueprint.json'): string {
  const inRoot = path.join(craftRoot(id), file);
  if (fs.existsSync(inRoot)) return inRoot;
  return path.join(REPO, 'testdata', id, file);
}

// ---------- VERSIONED CACHE: rev + SHA-256 of every craft's blueprint.json ---
// The stamp rides THREE places and must always describe the SAME file: the
// catalog entry (virtual:gallery), the /corpus route's X-Blueprint-Rev /
// X-Blueprint-Sha response headers, and the bytes actually served. All three
// go through blueprintMeta()/blueprintSha() below, which resolve through
// craftFile()'s corpus-first-fixture-floor — a staleness flag can therefore
// NEVER lie about a different file than the one a download would fetch.
//
// Strategy: EAGER hashing at catalog compile, memoised per
// (path, size, mtimeMs). Measured on the full machine corpus (244
// blueprint.json, 44 MiB under the configured Steam client/blueprints +
// the testdata floor): the FIRST compile spends ~150 ms; every later
// compile (dev-watch change, rebuild) re-hashes ONLY the changed files.
// A lazy background fill + module invalidation was deliberately NOT built:
// at this corpus scale it only adds invalidation races for no perceptible
// gain. If a corpus ever grows into the many-thousands range, move the
// galleryData() sha line into a deferred fill that invalidates the virtual
// module once digests land (escape hatch, documented in app/README.md).

const shaMemo = new Map<string, { size: number; mtimeMs: number; sha: string }>();

/** hex SHA-256 of the file AS SERVED (UTF-8 JSON bytes); memoised on the
 *  (size, mtimeMs) identity, so unchanged files never rehash. '' unreadable. */
export function blueprintSha(file: string): string {
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return ''; }
  const hit = shaMemo.get(file);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.sha;
  const sha = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  shaMemo.set(file, { size: st.size, mtimeMs: st.mtimeMs, sha });
  return sha;
}

/** the version stamp of a craft's blueprint.json EXACTLY as the /corpus
 *  route would serve it (same craftFile resolution). null = no file. */
export function blueprintMeta(id: string): { rev: string; sha: string; bytes: number; mtime: number } | null {
  const file = craftFile(id);
  let st: fs.Stats;
  try { st = fs.statSync(file); } catch { return null; }
  return { rev: `${st.size}-${Math.round(st.mtimeMs)}`, sha: blueprintSha(file),
    bytes: st.size, mtime: st.mtimeMs };
}

/** TEST-ONLY: forget the memoised corpus root so an env change
 *  (ARCHEAN_BLUEPRINTS) takes effect mid-process. */
export function resetCorpusCache(): void { corpusCache = null; }

// ---------- catalog rules (mirror tools/make_landing.py — keep in sync) ----------
/** synthetic viewer/matrix fixtures: the orient probe + the COMPONENT MATRIX
 *  pairs (90000010NN rest / 90000020NN deflected). 900000xxxx is far outside
 *  real Steam ids (≈3.3e9, growing) — a shape rule, so a fixture written into
 *  ANY corpus folder never pollutes the gallery. */
const FIXTURE = /^900000\d{4}$/;
/** novelty/repeat builds kept in the corpus but not on the landing page (V1) */
const EXCLUDE = new Set(['3384910875', '3334593406', '3347018068', '3334591920']);
/** "23", "Workshop item 3406025722"… (deleted/untitled) → skip (V1 rule) */
const NUMERIC_NAME = /^(Workshop item\s+)?[\d\s.,_\-]+$/;
/** titles the V1 landing curates offline (tsv rows may be missing/stale) */
const CURATED: Record<string, string> = {
  '3327182790': 'Cheap Exploration Plane',
  '3334591920': '7x-Port-a-MiningRig',
  '3334593406': 'port-a-power-plugin',
  '3334698274': "Jimmy's Adventure",
  '3347018068': 'Oh no.. it flies',
  '3348400160': 'Cede (outdated)',
  '3373508061': 'Transcede-1060 (outdated)',
  '3381670618': 'Dolphin-700 (Updated)',
  '3384910875': 'Glideon',
  '3385814436': 'Golden Throne',
  '3385870429': 'Christmas Present',
  '3385876909': 'Christmas Tree',
  '3386936607': 'Plain',
  '3404843025': 'Sprite 500 - RCS',
};

/** tools/ws-names.tsv (id<TAB>title, Steam-fetched) with make_landing's
 *  junk-row filter; git-tracked, so it works on a fresh clone too */
function tsvNames(): Map<string, string> {
  const m = new Map<string, string>();
  let txt = '';
  try { txt = fs.readFileSync(path.join(REPO, 'tools', 'ws-names.tsv'), 'utf8'); } catch { return m; }
  for (const line of txt.split('\n')) {
    const parts = line.replace(/\r$/, '').split('\t');
    if (parts.length === 2 && !parts[1]!.startsWith('<title>')
      && !parts[1]!.includes('Error') && parts[1] !== 'Steam Workshop') m.set(parts[0]!, parts[1]!);
  }
  return m;
}

/** blueprint `data.alias` — the name the game editor stores in the craft file */
function aliasOf(file: string): string {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { data?: { alias?: unknown } };
    return typeof j.data?.alias === 'string' ? j.data.alias.trim() : '';
  } catch { return ''; }
}

/** catalog catalog dirs: configured corpus UNION the testdata fixture floor
 *  (corpus wins on duplicates — its file is what /corpus/<id>/ serves) */
function catalogIds(): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const root of [path.join(REPO, 'testdata'), corpusDir()]) {
    let ids: string[] = [];
    try { ids = fs.readdirSync(root); } catch { continue; }
    for (const d of ids) {
      if (!/^\d{6,}$/.test(d) || FIXTURE.test(d) || EXCLUDE.has(d)) continue;
      if (fs.existsSync(path.join(root, d, 'blueprint.json'))) dirs.set(d, path.join(root, d));
    }
  }
  return dirs;
}

/** snapshot the catalog at compile time: ids, workshop names/authors, preview
 *  availability — baked into the bundle as virtual:gallery */
export function galleryData(): GalleryEntry[] {
  const dirs = catalogIds();
  let ws: Record<string, { name?: string; author?: string }> = {};
  try { ws = JSON.parse(fs.readFileSync(path.join(REPO, 'viewer/workshop.json'), 'utf8')); }
  catch { /* names fall back to the tsv/alias table */ }
  const tsv = tsvNames();
  const out: GalleryEntry[] = [];
  for (const [id, dir] of [...dirs].sort()) {
    // V1 landing name tiers: workshop.json → curated/tsv → file alias;
    // numeric-only names (deleted items) stay out of the catalog
    const name = ws[id]?.name?.trim() || CURATED[id] || tsv.get(id) || aliasOf(path.join(dir, 'blueprint.json'));
    if (!name || NUMERIC_NAME.test(name)) continue;
    // previews live beside the blueprint in EITHER root (Steam saves carry
    // none; testdata ships 56 of them). URL scheme (Pages = the app at the
    // SITE ROOT): a testdata copy -> 'testdata/<id>/…' (exact at the Pages
    // root and on the dev '/' page, where the plugin serves /testdata/;
    // App.tsx's CardPreview flips to '../testdata/…' if that 404s, i.e. the
    // '/app/' copy of the same site); a corpus-only preview ->
    // 'corpus/<id>/…' (dev-only — the Pages build pins the corpus to
    // testdata, so it never carries corpus-only files).
    const prevTest = fs.existsSync(path.join(REPO, 'testdata', id, 'preview.jpg'));
    const prevCorpus = !prevTest && fs.existsSync(path.join(dir, 'preview.jpg'));
    // version stamp of blueprint.json (EAGER, memoised — see § VERSIONED
    // CACHE above): dir is the SAME folder the /corpus route resolves
    // (corpus wins when it carries the file), so entry ≡ served bytes.
    const meta = blueprintMeta(id);
    out.push({ id, name, author: ws[id]?.author,
      preview: prevTest ? `testdata/${id}/preview.jpg`
        : prevCorpus ? `corpus/${id}/preview.jpg` : null,
      rev: meta?.rev ?? '', sha: meta?.sha ?? '',
      bytes: meta?.bytes ?? 0, mtime: meta?.mtime ?? 0 });
  }
  return out;
}

/** static file response with cache validators: dev reloads and re-navigation
 *  through the gallery must revalidate (304), not re-transfer */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string, maxAge = 0) {
  let st;
  try { st = fs.statSync(file); } catch { res.statusCode = 404; res.end('not found'); return; }
  const etag = `W/"${st.size}-${Math.round(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) { res.statusCode = 304; res.end(); return; }
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', maxAge ? `public, max-age=${maxAge}` : 'no-cache');
  // VERSIONED CACHE: the app's cache validates the fetched bytes against
  // X-Blueprint-Sha and stamps the entry with X-Blueprint-Rev (crafts.ts).
  // The digest is memoised per (size, mtimeMs), so this is a Map hit for
  // every unchanged file; the stat we already did IS the memo validator.
  if (file.endsWith('blueprint.json')) {
    res.setHeader('X-Blueprint-Sha', blueprintSha(file));
    res.setHeader('X-Blueprint-Rev', `${st.size}-${Math.round(st.mtimeMs)}`);
  }
  res.end(fs.readFileSync(file));
}

/** repo assets the SPA reuses from the legacy tree: /workshop.json + /models/* */
function repoFile(req: IncomingMessage, res: ServerResponse, rel: string, type: string) {
  sendFile(req, res, path.join(REPO, rel), type);
}

function handler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
  if (url === '/workshop.json') return repoFile(req, res, 'viewer/workshop.json', 'application/json');
  if (url.startsWith('/models/') || url.startsWith('/atlas/')) {
    // INDEXED form /atlas/<n>.json: n = position of the type name in the
    // SORTED manifest keys. Why: EasyPrivacy's generic substring rule
    // '/beacon.js' (analytics beacons) also matches 'Beacon.json' — the
    // GAME model of the Beacon part — so ANY URL naming that type dies in
    // Adblock Plus/Firefox (user report 2026-10-19: every other model
    // loaded, only the beacon became a white stand-in box). The indexed
    // route carries no type words at all; models.ts prefers it.
    const im = /^\/atlas\/(\d+)\.json$/.exec(url);
    if (im) {
      const mf = JSON.parse(fs.readFileSync(path.join(REPO, 'viewer/models/manifest.json'), 'utf8')) as Record<string, unknown>;
      const name = Object.keys(mf).sort()[+im[1]!];
      if (!name) { res.statusCode = 404; res.end('nope'); return; }
      return repoFile(req, res, `viewer/models/${name}.json`, 'application/json');
    }
    // named aliases: <Type>.json only, no traversal
    const m = /^\/(?:models|atlas)\/([A-Za-z0-9_.-]+\.json)$/.exec(url);
    if (!m || m[1]!.includes('..')) { res.statusCode = 404; res.end('nope'); return; }
    return repoFile(req, res, `viewer/models/${m[1]}`, 'application/json');
  }
  if (!url.startsWith('/corpus')) {
    // /viewer/<file>: the RETIRED legacy viewer, served in dev/preview too,
    // so the gallery's small "legacy blueprint viewer" footer link works
    // while developing (on Pages it lives at the repo root next to the app)
    if (url.startsWith('/viewer/')) {
      const root0 = path.join(REPO, 'viewer');
      const f = path.resolve(root0, decodeURIComponent(url).slice('/viewer/'.length));
      if (!f.startsWith(root0 + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) {
        res.statusCode = 404; res.end('not found'); return;
      }
      sendFile(req, res, f, f.endsWith('.html') ? 'text/html'
        : f.endsWith('.js') ? 'text/javascript' : f.endsWith('.json') ? 'application/json'
        : f.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
      return;
    }
    // /testdata/<id>/<file>: the STATIC Pages layout served in dev/preview
    // too, so the catalog's '../testdata/…' preview + blueprint routes hit
    // the same files in every environment
    if (url.startsWith('/testdata/')) {
      const mt = /^\/testdata\/(\d{6,})\/(.+)$/.exec(url);
      const root0 = mt ? path.join(REPO, 'testdata', mt[1]!) : '';
      const f = mt && root0 ? path.resolve(root0, mt[2]!) : '';
      if (!f || !root0 || !f.startsWith(root0 + path.sep) || !fs.existsSync(f)) {
        res.statusCode = 404; res.end('not found'); return;
      }
      sendFile(req, res, f, f.endsWith('.json') ? 'application/json'
        : f.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream',
      f.endsWith('.jpg') ? 3600 : 0);
      return;
    }
    return next();
  }
  const rel = url.replace(/^\/corpus\/?/, '');
  if (rel === '') {                                   // listing (same union as the catalog)
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    res.end([...catalogIds().keys()].sort().map(d => `<a href="${d}/">${d}/</a>`).join('\n'));
    return;
  }
  // <id>/<file> with strict traversal guard; missing files fall back to the
  // repo testdata fixture floor PER FILE (craftFile — a Steam corpus craft
  // can carry blueprint.json while its preview.jpg only exists in testdata)
  const m = /^(\d{6,})\/(.+)$/.exec(rel);
  if (!m) { res.statusCode = 404; res.end('not found'); return; }
  const id = m[1]!, wanted = m[2]!;
  const roots = [path.join(corpusDir(), id), path.join(REPO, 'testdata', id)];
  let file: string | null = null;
  for (const root0 of roots) {
    const f = path.resolve(root0, wanted);
    if (f.startsWith(root0 + path.sep) && fs.existsSync(f)) { file = f; break; }
  }
  if (!file) { res.statusCode = 404; res.end('not found'); return; }
  sendFile(req, res, file, file.endsWith('.json') ? 'application/json'
    : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream',
  file.endsWith('.jpg') ? 3600 : 0);   // previews cache 1 h; blueprints revalidate
}

const VIRTUAL_ID = 'virtual:gallery';
const RESOLVED = '\0' + VIRTUAL_ID;

export default function corpus(): PluginOption {
  return {
    name: 'archean-corpus',
    resolveId(id) { return id === VIRTUAL_ID ? RESOLVED : null; },
    load(id) {
      if (id === RESOLVED) return `export const GALLERY = ${JSON.stringify(galleryData())};`;
      return null;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handler);
      // dev: corpus, fixture floor, or name tables change → recompile the catalog
      try {
        server.watcher.add(corpusDir());
        server.watcher.add(path.join(REPO, 'testdata'));
        server.watcher.add(path.join(REPO, 'viewer/workshop.json'));
        server.watcher.add(path.join(REPO, 'tools/ws-names.tsv'));
      } catch { /* watching is best-effort */ }
      server.watcher.on('change', async f => {
        if (f.startsWith(corpusDir()) || f.startsWith(path.join(REPO, 'testdata'))
          || f.endsWith('workshop.json') || f.endsWith('ws-names.tsv')) {
          // the compiled catalog is load()-cached in the module graph, so a
          // bare full-reload would keep serving the PREVIOUS rev/sha stamps.
          // Invalidate the virtual module so the reload re-runs galleryData()
          // (blueprint edits re-hash via the (size,mtime) memo — cheap).
          const mod = server.moduleGraph.getModuleById(RESOLVED);
          if (mod) await server.moduleGraph.invalidateModule(mod);
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    configurePreviewServer(server: PreviewServer) { server.middlewares.use(handler); },
  };
}
