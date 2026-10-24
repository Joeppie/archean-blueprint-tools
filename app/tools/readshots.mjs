// readshots.mjs — the four README/help screenshots, driven through the REAL
// editor UI (the same plumbing the e2e suite and sphereshot.mjs use, on the
// AMD iGPU — the NVIDIA card stays free for the models):
//
//   wiring-badger.png        Chip's Badger (3326372833) in WIRE mode with the
//                            WIREFRAME hull OFF-solid so every cable reads —
//                            hover a cable for the endpoint chip
//   balloon-ghost.png        TOOLS ▸ Generate balloon (spheroid) — the staged
//                            placement ghost with its ⟲/↩/✕/✔ label
//   balloon-generating.png   the same ghost WITH the parameter dialog back
//                            (↩) and dragged aside = the generating view
//   zeppelin-fins.png        cyl + nose balloon with the v1.9 tail section
//                            built (rudder + ailerons on SmallHinges), sky
//                            backdrop
//   falcon-desert.png        Chip Patton's Falcon (3348745601) under the
//                            desert (Goegap) backdrop
//
// Every shot prints NUMERIC proof (projected bbox coverage, backdrop state,
// hover chip text, dialog/ghost visibility) — this driver has no eyeball, so
// the numbers are the eyeball. Framing constants live in ONE table below.
//
// usage: node tools/readshots.mjs [port] [shot ...]   (shot = basename)
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const PORT = process.argv[2] && /^\d+$/.test(process.argv[2]) ? process.argv[2] : '5175';
const ONLY = process.argv.slice(2).filter((a) => !/^\d+$/.test(a));
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = new URL('../../assets/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});

/** fresh context → page; `init` keys land in localStorage BEFORE boot */
async function open(init = {}) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, { 'archean-app-debug': '1', ...init });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, p, errors };
}

/** aim the camera explicitly: look-at target, position = target + dir·dist.
 *  The projection hooks read camera.matrixWorldInverse, which three refreshes
 *  at RENDER time — so update it here and let one frame land before probing. */
const aim = async (p, tgt, dir, dist) => {
  await p.evaluate(({ tgt, dir, dist }) => {
    const e = window.__ARCHEAN__.engine;
    const n = Math.hypot(dir[0], dir[1], dir[2]);
    e.controls.target.set(tgt[0], tgt[1], tgt[2]);
    e.camera.position.set(tgt[0] + dir[0] / n * dist, tgt[1] + dir[1] / n * dist, tgt[2] + dir[2] / n * dist);
    e.controls.update();
    e.camera.updateMatrixWorld(true);
    e.invalidate();
  }, { tgt, dir, dist });
  await p.waitForTimeout(250);
};

/** project a world box (FILE coords — screenPoint adds the scene offset) into px */
const cover = (p, mn, mx, pad = 0) => p.evaluate(([m, x, pad2]) => {
  const A = window.__ARCHEAN__, e = A.engine;
  e.camera.updateMatrixWorld(true);
  const cv = e.renderer.domElement.getBoundingClientRect();
  let lo = [1e9, 1e9], hi = [-1e9, -1e9], behind = 0;
  for (const px of [m[0], x[0]]) for (const py of [m[1], x[1]]) for (const pz of [m[2], x[2]]) {
    const s = A.screen(px, py, pz);
    if (!s) { behind++; continue; }
    lo = [Math.min(lo[0], s[0]), Math.min(lo[1], s[1])];
    hi = [Math.max(hi[0], s[0]), Math.max(hi[1], s[1])];
  }
  const f = Math.max(0, (hi[0] - lo[0]) * (hi[1] - lo[1])) / (cv.width * cv.height);
  const inset = lo[0] >= cv.left - pad2 && hi[0] <= cv.right + pad2
    && lo[1] >= cv.top - pad2 && hi[1] <= cv.bottom + pad2;
  return { frac: +f.toFixed(3), inset, behind, box: lo.map(Math.round).concat(hi.map(Math.round)) };
}, [mn, mx, pad]);

/** pull the camera back along dir until the box sits IN the canvas */
async function autoFrame(p, tgt, mn, mx, dir, dist0, tag = '') {
  let dist = dist0, m = null;
  for (let i = 0; i < 9; i++) {
    await aim(p, tgt, dir, dist);
    m = await cover(p, mn, mx, 8);
    if (m.inset && !m.behind) break;
    dist *= 1.3;
  }
  console.log(`${tag} frame d=${dist.toFixed(1)}`, m);
  return m;
}

const shoot = async (p, name) => {
  await p.screenshot({ path: OUT + name + '.png' });
  console.log(`  → assets/${name}.png`);
};

/** wait for the live preview line to resolve and OK to arm */
const ready = async (p, re) => {
  await p.waitForFunction((src) => {
    const t = document.querySelector('[data-testid="tool-preview"]')?.textContent ?? '';
    return new RegExp(src).test(t) && !t.includes('planning')
      && document.querySelector('[data-testid="tool-ok"]')?.disabled === false;
  }, re.source, { timeout: 90_000 });
  return p.locator('[data-testid="tool-preview"]').textContent();
};

// ---------------------------------------------------------------- 1. wiring
async function wiring() {
  const { ctx, p, errors } = await open();
  await p.goto(`${BASE}/?craft=3326372833`, { waitUntil: 'load' });
  await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
  await p.waitForFunction(() => window.__ARCHEAN__.engine.pendingReal === 0, null,
    { timeout: 120_000 }).catch(() => {});
  await p.getByTestId('mode-wire').click();
  await p.getByTestId('wire-cables').waitFor({ timeout: 20_000 });
  // WIREFRAME: hull solids off, lattice wire on — the wires show THROUGH
  await p.evaluate(() => { window.__ARCHEAN__.engine.setOption('wire', true); });
  const box = await p.evaluate(() => {
    const bp = window.__ARCHEAN__.engine.blueprint;
    return [bp.box_min, bp.box_max].map((v) => [v.x, v.y, v.z]);
  });
  const tgt = box[0].map((v, i) => (v + box[1][i]) / 2);
  await autoFrame(p, tgt, box[0], box[1], [0.85, 0.3, 0.95],
    await p.evaluate(() => window.__ARCHEAN__.engine.frameD), 'wiring:');
  // hover a cable whose screen point sits in the canvas: chip + gold light
  const pt = await p.evaluate(() => {
    const A = window.__ARCHEAN__, cv = A.engine.renderer.domElement.getBoundingClientRect();
    for (let i = 0; i < 300; i++) {
      const s = A.cablePoint(i);
      if (s && s.x > cv.left + cv.width * 0.15 && s.x < cv.right - cv.width * 0.25
        && s.y > cv.top + cv.height * 0.15 && s.y < cv.bottom - cv.height * 0.2) return s;
    }
    return null;
  });
  if (pt) {
    await p.mouse.move(pt.x, pt.y, { steps: 4 });
    await p.waitForFunction(() => !!window.__ARCHEAN__.wireHover(), null, { timeout: 5_000 })
      .catch(() => {});
  }
  console.log('wiring: hover chip', pt ? await p.evaluate(() => window.__ARCHEAN__.wireHover()) : null);
  await p.waitForTimeout(600);
  await shoot(p, 'wiring-badger');
  console.log('wiring: errors', errors.length);
  await ctx.close();
}

// ------------------------------------------------------- balloon staging
/** new craft → TOOLS ▸ Generate balloon with these params → OK → confirm */
async function stageBalloon(p, { rx, ry, rz, round, fins }) {
  await p.goto(`${BASE}/`, { waitUntil: 'load' });
  await p.getByTestId('gallery-new').click();
  await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
  await p.getByTestId('tools-menu').click();
  await p.getByTestId('tool-balloon').click();
  await p.getByTestId(`tool-opt-profile-${round ? 'round' : 'cylinder'}`).click();
  if (fins) await p.getByTestId('tool-opt-fins-on').click();
  for (const [k, v] of [['rx', rx], ['ry', ry], ['rz', rz]])
    await p.evaluate(([k2, v2]) => {
      const el = document.querySelector(`[data-testid="tool-range-${k2}"]`);
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v2));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [k, v]);
  console.log('  preview:', (await ready(p, /tri|dev/))?.trim().slice(0, 150));
  await p.getByTestId('tool-ok').click();
  await p.getByTestId('tool-confirm').click();
  await p.getByTestId('place-label').waitFor({ timeout: 60_000 });
}

/** the staged ghost's WORLD bbox read off the engine. clusterBBoxG() already
 *  rides the current cell-offset drag (measured: the g-box moves with every
 *  placeShift), so world = (g − 6)·0.25 verbatim. */
const ghostBox = (p) => p.evaluate(() => {
  const s = window.__ARCHEAN__.placeGhost();
  if (!s?.bb) return null;
  const w = (g) => (g - 6) * 0.25;
  return [s.bb[0].map(w), s.bb[1].map(w)];
});

// ------------------------------------------- 2. spheroid ghost (generating)
async function balloonGhost() {
  const { ctx, p, errors } = await open();
  await stageBalloon(p, { rx: 5, ry: 4, rz: 5, round: true });
  // stand it ON the pad: a 16-cell drag up (the ghost's bbox centre sits at
  // y −ry, the pad grid stays at the deck level until a reload re-pins it)
  await p.evaluate(() => window.__ARCHEAN__.placeShift([0, 16, 0]));
  const bb = await ghostBox(p);
  console.log('ghost: world bbox', bb);
  const tgt = bb[0].map((v, i) => (v + bb[1][i]) / 2);
  await autoFrame(p, tgt, bb[0], bb[1], [0.9, 0.42, 1.0], 22, 'ghost:');
  await p.waitForTimeout(800);
  await shoot(p, 'balloon-ghost');

  // ------- 3. the generating view: ↩ back to the dialog, dragged aside
  await p.getByTestId('place-back').click();
  await p.getByTestId('tool-dialog-balloon').waitFor({ timeout: 20_000 });
  const bar = await p.getByTestId('tool-drag').boundingBox();
  await p.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await p.mouse.down();
  await p.mouse.move(bar.x + bar.width / 2 - 390, bar.y + bar.height / 2 + 120, { steps: 8 });
  await p.mouse.up();
  console.log('generating: ghost still up',
    await p.evaluate(() => window.__ARCHEAN__.placeGhost()?.shown ?? false),
    'params kept rx =', await p.getByTestId('tool-num-rx').inputValue());
  await p.waitForTimeout(500);
  await shoot(p, 'balloon-generating');
  console.log('balloon: errors', errors.length);
  await ctx.close();
}

// ----------------------------------------------- 4. built zeppelin, sky
async function zeppelin() {
  const { ctx, p, errors } = await open();
  await stageBalloon(p, { rx: 4, ry: 4, rz: 12, round: false, fins: true });
  const bb = await ghostBox(p);          // the exact body box, before the build
  await p.getByTestId('place-build').click();
  await p.getByTestId('tool-toast').waitFor({ timeout: 60_000 });
  await p.waitForFunction(() => window.__ARCHEAN__.engine.pendingReal === 0, null,
    { timeout: 120_000 }).catch(() => {});
  await p.waitForFunction(() => window.__ARCHEAN__.backdrop().ready, null, { timeout: 60_000 });
  console.log('zeppelin: backdrop', await p.evaluate(() => window.__ARCHEAN__.backdrop()));
  // behind and above the tail looking forward along the ship (+z = tail end)
  const tgt = [0, (bb[0][1] + bb[1][1]) / 2, bb[0][2] + (bb[1][2] - bb[0][2]) * 0.72];
  await autoFrame(p, tgt, bb[0], bb[1], [0.62, 0.34, 1.0], 30, 'zeppelin:');
  await p.waitForTimeout(1200);
  await shoot(p, 'zeppelin-fins');
  console.log('zeppelin: errors', errors.length);
  await ctx.close();
}

// ------------------------------------------------- 5. Falcon, desert sky
async function falcon() {
  const { ctx, p, errors } = await open({ 'archean-app-backdrop': 'desert' });
  await p.goto(`${BASE}/?craft=3348745601`, { waitUntil: 'load' });
  await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
  await p.waitForFunction(() => window.__ARCHEAN__.engine.pendingReal === 0, null,
    { timeout: 120_000 }).catch(() => {});
  await p.waitForFunction(() => window.__ARCHEAN__.backdrop().ready, null, { timeout: 60_000 });
  console.log('falcon: backdrop', await p.evaluate(() => window.__ARCHEAN__.backdrop()));
  const box = await p.evaluate(() => {
    const bp = window.__ARCHEAN__.engine.blueprint;
    return [bp.box_min, bp.box_max].map((v) => [v.x, v.y, v.z]);
  });
  // low three-quarter view: the desert horizon through the see-through pad
  const tgt = box[0].map((v, i) => (v + box[1][i]) / 2);
  await autoFrame(p, tgt, box[0], box[1], [1.0, 0.2, -0.42],
    await p.evaluate(() => window.__ARCHEAN__.engine.frameD), 'falcon:');
  await p.waitForTimeout(1200);
  await shoot(p, 'falcon-desert');
  console.log('falcon: errors', errors.length);
  await ctx.close();
}

const SHOTS = {
  'wiring-badger': wiring, 'balloon-ghost': balloonGhost,
  'balloon-generating': balloonGhost, 'zeppelin-fins': zeppelin, 'falcon-desert': falcon,
};
const seen = new Set();
for (const [name, fn] of Object.entries(SHOTS)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const key = fn.name;
  if (seen.has(key)) continue;                      // ghost + generating share one run
  seen.add(key);
  console.log(`== ${name}`);
  await fn();
}
await b.close();
console.log('done —', OUT);
