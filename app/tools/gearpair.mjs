// gearpair.mjs — live dev↔app world-box pair for NESTED subgrid parts.
//
// v1.11.8 THE RIG CHAIN (subgrid.ts) renders Build-nested content through
// the game's rig affines (dev blueprint.js readBuild). This audit measures,
// per craft, the WORLD AABB centre of every part nested below a Build
// (depth ≥ 2 nesting: the rigs) in BOTH viewers' live scenes, paired by
// flattened component index (identical dev readBuild order both sides).
// The change is landed only if every rig craft's parts move TOWARD dev.
//
// usage:  cd app && node tools/gearpair.mjs <craft-id>[,...] [--tol=0.25]
//         [--types=Wheel|SmallPivot|MiniRouter|...]   (default: all nested)
import { chromium } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV = 'https://viewer.xenontools.dev/';
const APP = process.env.OURS ?? 'http://127.0.0.1:5175';
function resolveCorpus() {
  if (process.env.ARCHEAN_BLUEPRINTS) return resolve(process.env.ARCHEAN_BLUEPRINTS);
  const conf = resolve(REPO, 'blueprints.conf');
  if (existsSync(conf)) {
    const m = /^\s*blueprints\s*=\s*(.+)$/m.exec(readFileSync(conf, 'utf8'));
    if (m) return m[1].trim();
  }
  return resolve(REPO, 'testdata');
}
const args = process.argv.slice(2);
const arg = (k, d) => { const e = args.find(s => s.startsWith(`--${k}=`)); return e ? e.split('=').slice(1).join('=') : d; };
const CORPUS = arg('corpus', resolveCorpus());
const TOL = Number(arg('tol', 0.25));
const TYPES = args.find(a => a.startsWith('--types=')) ? new RegExp(arg('types', '')) : null;
const CRAFTS = args.filter(a => !a.startsWith('--')).flatMap(a => a.split(',')).filter(Boolean);
if (!CRAFTS.length) { console.error('usage: node tools/gearpair.mjs <craft-id>[,...]'); process.exit(2); }

// dev readBuild order (mirror of flattenComponents): nested content BEFORE
// its Build. We only need the nested (depth≥2) part list per craft.
function nestedParts(bp) {
  const out = [];
  let idx = 0;
  const walk = (cs, depth) => {
    for (const c of cs) {
      const sub = c.type === 'Build' ? c.data?.components : undefined;
      if (sub) walk(sub, depth + 1);          // content first (dev readBuild)
      // Build entries have no rendered box in either viewer (assembly
      // nodes) — the audit pairs physical parts only
      if (depth >= 2 && c.type !== 'Build' && (!TYPES || TYPES.test(c.type))) out.push({ i: idx, c, depth });
      idx++;
    }
  };
  walk(bp.data.components, 0);
  return out;
}

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
});
const page = await (await browser.newContext({ viewport: { width: 1100, height: 760 } })).newPage();

let allOk = true;
for (const id of CRAFTS) {
  const file = resolve(CORPUS, id, 'blueprint.json');
  if (!existsSync(file)) { console.log(`${id}: not in corpus, skip`); continue; }
  const bp = JSON.parse(readFileSync(file, 'utf8'));
  const parts = nestedParts(bp);
  if (!parts.length) { console.log(`${id}: no nested parts (identity craft), skip`); continue; }

  // ---------- dev ----------
  await page.goto(DEV, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', file);
  await page.waitForSelector('#atelier:not(.hidden)', { timeout: 120_000 });
  await page.waitForFunction(() =>
    document.getElementById('loading').classList.contains('hidden') &&
    /status-dot (ok|idle|error)/.test(document.getElementById('status-dot').className), null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__xv?.scene, null, { timeout: 60_000 });
  await page.waitForTimeout(1500);
  // pair on the app engine's own flattenComponents numbering (the same dev
  // readBuild order) — the audit tool does NOT re-derive indices in JS.
  const idxList = parts.map(p => p.i);
  const devBoxes = await page.evaluate(() => {
    const x = window.__xv;
    const out = {};
    for (const lk of Object.keys(x.scene.layers)) {
      x.scene.layers[lk].traverse(g => {
        const ci = g.userData?.component;
        if (ci === undefined) return;
        const b = g.userData?.box;
        if (!b) return;
        if (out[ci]) return;
        out[ci] = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
      });
    }
    return out;
  });

  // ---------- ours ----------
  await page.goto(`${APP}/?craft=${id}`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__ARCHEAN__, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.__ARCHEAN__.stats().loads >= 1, null, { timeout: 120_000 });
  // dev boxes the streamed GLTF world AABB; pair against the SAME geometry:
  // the app's streamed real model (userData {kind:'comp', ci, real}) when it
  // has arrived for this part, else the collider-based proxy stand-in.
  const centreMap = async () => page.evaluate((idxList) => {
    const e = window.__ARCHEAN__.engine;
    const c = e.moff;                       // world = file + moff
    const set = new Set(idxList);
    const aabb = (o) => {
      let mn = null, mx = null;
      o.updateWorldMatrix(true, true);
      o.traverse(ch => {
        if (!ch.isMesh || !ch.geometry) return;
        ch.updateWorldMatrix(true, false);
        const bb = ch.geometry.boundingBox
          ?? (ch.geometry.computeBoundingBox(), ch.geometry.boundingBox);
        if (!bb) return;
        const m4 = ch.matrixWorld;
        for (const sx of [bb.min.x, bb.max.x]) for (const sy of [bb.min.y, bb.max.y]) for (const sz of [bb.min.z, bb.max.z]) {
          const v = new (o.position.constructor)(sx, sy, sz).applyMatrix4(m4);
          if (!mn) { mn = [v.x, v.y, v.z]; mx = [v.x, v.y, v.z]; }
          else for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v.toArray()[k]); mx[k] = Math.max(mx[k], v.toArray()[k]); }
        }
      });
      return mn ? [mn, mx] : null;
    };
    const out = {};
    const real = {};
    e.scene.traverse(o => {
      const ci = o.userData?.subRealCi;   // nested real models only
      if (typeof ci === 'number' && set.has(ci)) {
        const bb = aabb(o);
        if (bb) real[ci] = bb;
      }
    });
    e.scene.traverse(o => {
      const ci = o.userData?.subComp;
      if (typeof ci !== 'number' || !set.has(ci)) return;
      const bb = real[ci] ?? aabb(o);
      if (!bb) return;
      const [mn, mx] = bb;
      out[ci] = [0, 1, 2].map(k => +(((mn[k] + mx[k]) / 2) - c[['x', 'y', 'z'][k]]).toFixed(3));
    });
    return out;
  }, idxList);
  await page.waitForTimeout(14000);            // nested real models stream in
  let ours = await centreMap();
  await page.waitForTimeout(6000);
  const ours2 = await centreMap();
  ours = { ...ours, ...ours2 };                // real boxes override proxies

  // ---------- pair ----------
  const rows = [];
  for (const { i, c, depth } of parts) {
    const d = devBoxes[i], o = ours[i];
    if (!d || !o) { rows.push({ i, type: c.type, depth, note: d ? 'missing-ours' : 'missing-dev' }); continue; }
    const dist = Math.hypot(d[0] - o[0], d[1] - o[1], d[2] - o[2]);
    rows.push({ i, type: c.type, depth,
      fp: [c.position.x, c.position.y, c.position.z].map(v => +v.toFixed(2)),
      dev: d.map(v => +v.toFixed(2)), ours: o.map(v => +v.toFixed(2)),
      dist: +dist.toFixed(3), ok: dist <= TOL });
  }
  const bad = rows.filter(r => r.dist !== undefined && !r.ok);
  const miss = rows.filter(r => r.note);
  console.log(`\n${id}: ${parts.length} nested parts, ${bad.length} mismatch(>${TOL}m)` +
    (miss.length ? `, ${miss.length} unpaired` : ''));
  for (const r of rows.filter(r => r.dist !== undefined))
    console.log('  ' + (r.ok ? '   ' : '<<< ') + JSON.stringify(r));
  for (const r of miss) console.log('  -   ' + JSON.stringify(r));
  if (bad.length || miss.length) allOk = false;
}
await browser.close();
console.log(allOk ? '\nGEARPAIR PASS (tol ' + TOL + ' m)' : '\nGEARPAIR FAIL (tol ' + TOL + ' m)');
process.exit(allOk ? 0 : 1);
