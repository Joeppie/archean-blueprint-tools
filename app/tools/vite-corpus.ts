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
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginOption, PreviewServer, ViteDevServer } from 'vite';

const REPO = path.resolve(import.meta.dirname, '..', '..');

export interface GalleryEntry { id: string; name: string; author?: string; preview: string | null }

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

/** snapshot the catalog at compile time: ids, workshop names/authors, preview
 *  availability — baked into the bundle as virtual:gallery */
export function galleryData(): GalleryEntry[] {
  const root = corpusDir();
  let ids: string[] = [];
  try {
    ids = fs.readdirSync(root).filter(d =>
      /^\d{6,}$/.test(d) && fs.existsSync(path.join(root, d, 'blueprint.json'))).sort();
  } catch { return []; }
  let ws: Record<string, { name?: string; author?: string }> = {};
  try { ws = JSON.parse(fs.readFileSync(path.join(REPO, 'viewer/workshop.json'), 'utf8')); }
  catch { /* names fall back to ids */ }
  return ids.map(id => ({
    id,
    name: ws[id]?.name?.trim() || `Workshop ${id}`,
    author: ws[id]?.author,
    preview: fs.existsSync(path.join(root, id, 'preview.jpg')) ? `/corpus/${id}/preview.jpg` : null,
  }));
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
  res.end(fs.readFileSync(file));
}

/** repo assets the SPA reuses from the legacy tree: /workshop.json + /models/* */
function repoFile(req: IncomingMessage, res: ServerResponse, rel: string, type: string) {
  sendFile(req, res, path.join(REPO, rel), type);
}

function handler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
  if (url === '/workshop.json') return repoFile(req, res, 'viewer/workshop.json', 'application/json');
  if (url.startsWith('/models/')) {
    // whitelisted shape: <Type>.json only, no traversal
    const m = /^\/models\/([A-Za-z0-9_.-]+\.json)$/.exec(url);
    if (!m || m[1]!.includes('..')) { res.statusCode = 404; res.end('nope'); return; }
    return repoFile(req, res, `viewer/models/${m[1]}`, 'application/json');
  }
  if (!url.startsWith('/corpus')) return next();
  const root = corpusDir();
  const rel = url.replace(/^\/corpus\/?/, '');
  if (rel === '') {                                   // listing
    let ids: string[] = [];
    try {
      ids = fs.readdirSync(root).filter(d =>
        /^\d{6,}$/.test(d) && fs.existsSync(path.join(root, d, 'blueprint.json')));
    } catch { /* missing corpus = empty listing */ }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    res.end(ids.map(d => `<a href="${d}/">${d}/</a>`).join('\n'));
    return;
  }
  // <id>/<file> with strict traversal guard
  const root0 = root;
  const file = path.resolve(root0, rel);
  if (!file.startsWith(root0 + path.sep)) { res.statusCode = 404; res.end('not found'); return; }
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
      // dev: corpus or workshop names change → recompile the catalog
      try {
        server.watcher.add(corpusDir());
        server.watcher.add(path.join(REPO, 'viewer/workshop.json'));
      } catch { /* watching is best-effort */ }
      server.watcher.on('change', f => {
        if (f.startsWith(corpusDir()) || f.endsWith('workshop.json')) {
          server.ws.send({ type: 'full-reload' });
        }
      });
    },
    configurePreviewServer(server: PreviewServer) { server.middlewares.use(handler); },
  };
}
