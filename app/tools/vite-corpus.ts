// vite-corpus.ts — dev/preview-server plugin serving the blueprint corpus.
// Implements AGENTS.md § Blueprint folder for the app: the corpus root comes
// from env ARCHEAN_BLUEPRINTS > repo-root blueprints.conf > <repo>/testdata —
// NEVER a hardcoded path. Mirrors tools/config.py's resolution.
//
// URLs:   /corpus/                     → directory listing (<a href="<id>/">,
//                                        same shape regtest.html scrapes)
//         /corpus/<id>/blueprint.json  → the file
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PluginOption, PreviewServer, ViteDevServer } from 'vite';

const REPO = path.resolve(import.meta.dirname, '..', '..');

function expandUser(p: string): string {
  return p.startsWith('~') ? path.join(process.env.HOME ?? '', p.slice(2)) : p;
}

/** env > blueprints.conf > <repo>/testdata (relative entries resolve vs repo). */
export function corpusDir(): string {
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
  return path.resolve(REPO, expandUser(raw));
}

function handler(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
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
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
  res.end(fs.readFileSync(file));
}

export default function corpus(): PluginOption {
  return {
    name: 'archean-corpus',
    configureServer(server: ViteDevServer) { server.middlewares.use(handler); },
    configurePreviewServer(server: PreviewServer) { server.middlewares.use(handler); },
  };
}
