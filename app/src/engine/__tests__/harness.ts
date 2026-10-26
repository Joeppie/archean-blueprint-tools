// The HEADLESS BOOT harness (docs/TEST-PYRAMID.md Phase 1, v1.12.1):
// the real Engine, the real open funnel (edit.ts openFunnel — the SAME
// parse → stamp → normalize the Editor runs), the real blueprint corpus
// from testdata/, the real model atlas from viewer/models/ — and NO
// canvas: the Engine's viewRect() answers on the virtual pad, so every
// pick/pose/census probe runs on plain node. This is the file that lets
// the "does it render in the right place" class leave the browser.
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { openFunnel } from '../edit';
import { bakeGeo, type LoadedModel, type ModelAtlas, type ModelGeo, type ModelManifest } from '../models';
import { Engine } from '../scene';

/** repo root, computed from this file (NEVER a machine path) */
export const REPO = resolve(__dirname, '..', '..', '..', '..');
export const testdataText = (id: string): string =>
  readFileSync(resolve(REPO, 'testdata', id, 'blueprint.json'), 'utf8');

/** the machine-local BLUEPRINT FOLDER per the config tiers (env
 *  ARCHEAN_BLUEPRINTS > gitignored blueprints.conf > repo testdata) —
 *  the same resolution tools/config.py + app/tools/vite-corpus.ts apply.
 *  Solo fixtures (90000030NN) live ONLY there; tests using this SKIP when
 *  the corpus is absent (a fresh clone must stay green). */
function corpusDirs(): string[] {
  const dirs = [process.env.ARCHEAN_BLUEPRINTS];
  try {
    const conf = readFileSync(resolve(REPO, 'blueprints.conf'), 'utf8');
    const m = /^blueprints\s*=\s*(.+)$/m.exec(conf);
    if (m) dirs.push(m[1]!.trim());
  } catch { /* no conf: env + testdata only */ }
  dirs.push(resolve(REPO, 'testdata'));
  return dirs.filter((d): d is string => !!d);
}

export function corpusText(id: string): string | null {
  for (const d of corpusDirs()) {
    const p = resolve(d, id, 'blueprint.json');
    try { return readFileSync(p, 'utf8'); } catch { /* try next tier */ }
  }
  return null;
}

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  get length(): number { return this.m.size; }
}

/** Canvas2D for makeLabel/axis labels/flow icons: every op a recorded
 *  no-op — a CanvasTexture is only READ at GL upload, which never happens
 *  with no renderer. */
function canvasStub(): Record<string, unknown> {
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, p: string) {
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'getImageData')
        return (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) });
      if (p === 'createLinearGradient' || p === 'createRadialGradient' || p === 'createPattern')
        return () => ({ addColorStop: () => { /* gradient stub */ } });
      return () => { /* draw stub */ };
    },
    set() { return true; },
  });
  return { width: 1, height: 1, style: {}, getContext: () => ctx, toDataURL: () => 'data:,' };
}

let stubbed = false;
function stubDom(): void {
  if (stubbed) return;
  stubbed = true;
  const g = globalThis as Record<string, unknown>;
  if (!g.localStorage) g.localStorage = new MemStorage();
  if (!g.document) {
    g.document = {
      createElement: (tag: string) =>
        tag === 'canvas' ? canvasStub()
          : { style: {}, classList: { add: () => {}, remove: () => {} }, setAttribute: () => {}, appendChild: () => {} },
      body: { appendChild: () => {}, removeChild: () => {} },
    };
  }
}

/** the game-model atlas served from DISK (viewer/models/), baked through
 *  the exact browser loader path (bakeGeo) */
export function diskAtlas(): ModelAtlas {
  const dir = resolve(REPO, 'viewer', 'models');
  const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as ModelManifest;
  const cache = new Map<string, LoadedModel | null>();
  return {
    manifest,
    async geoFor(type: string): Promise<LoadedModel | null> {
      if (!cache.has(type)) {
        const info = manifest[type];
        if (!info) cache.set(type, null);
        else {
          try {
            const json = JSON.parse(readFileSync(resolve(dir, `${type}.json`), 'utf8')) as ModelGeo;
            cache.set(type, { geo: bakeGeo(json), info });
          } catch (err) { console.error(`[diskAtlas ${type}]`, err); cache.set(type, null); }
        }
      }
      return cache.get(type)!;
    },
  };
}

/** open a corpus craft through the real funnel into a virtual-pad Engine */
export function openCraft(
  id: string, opts: { atlas?: ModelAtlas | null; w?: number; h?: number } = {},
): Engine {
  stubDom();
  const text = corpusText(id);
  if (text === null) throw new Error(`craft ${id}: not in testdata/ nor the resolved corpus`);
  const { bp } = openFunnel(text);
  const e = new Engine();
  e.setVirtualViewport(opts.w ?? 800, opts.h ?? 600);
  e.load(bp, opts.atlas === undefined ? diskAtlas() : opts.atlas);
  return e;
}

/** openCraft for SOLO fixtures that live only in the machine-local corpus;
 *  returns null when the corpus is absent (caller SKIPS the pin) */
export function openCraftOpt(
  id: string, opts: { atlas?: ModelAtlas | null; w?: number; h?: number } = {},
): Engine | null {
  stubDom();
  const text = corpusText(id);
  if (text === null) return null;
  const { bp } = openFunnel(text);
  const e = new Engine();
  e.setVirtualViewport(opts.w ?? 800, opts.h ?? 600);
  e.load(bp, opts.atlas === undefined ? diskAtlas() : opts.atlas);
  return e;
}

/** await the async real-model stream (load() spawns it; compRealBox lands
 *  once a part's geometry is in) */
export async function withRealModels(e: Engine, cis: number[], ms = 20_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (cis.every((ci) => e.compRealBox(ci) !== null)) return;
    if (Date.now() - t0 > ms) throw new Error(`real models for [${cis}] did not stream within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
