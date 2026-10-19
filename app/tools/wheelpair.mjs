// wheelpair.mjs — REAL-CRAFT component world-pose pair: XenonViewer vs our app.
//
// The solo-pair ritual (tools/make_solo_test.py + app/tools/solopair.mjs)
// compares LOCAL content boxes inverse-transformed by each viewer's OWN
// component matrix — exact for the CONTENT map (C·chain·C⁻¹·v), but
// STRUCTURALLY BLIND to anything riding the component ROOT: identity
// orientation fixtures plus a self-inverse-transform make a bogus ROOT
// rotation invisible. The suspension DROOP rule on wheels sailed straight
// through the full 104/104 solo verdict and only showed HERE, on the semi
// truck's real mount quaternions (every BigWheel disc ±0.899 m in z, 4 of 7
// SmallWheel casters ~0.29 m — 2026-10-19, the run that retired the droop;
// app/src/engine/compparts.ts now places wheels by the plain view law).
//
// So: whenever a component looks rotated/translated wrong in a REAL craft,
// run THIS over a craft that mounts it — per instance it pairs the WORLD
// bbox (dev: userData.box from the live scene graph; app: compRealBox) by
// the component's FILE position from the blueprint (identical data on both
// sides), so dev's flattened-index vs our top-level numbering never matters.
// >0.12 m ⇒ investigate: on LEGACY-format craft a root difference is a real
// app bug (the dev viewer's raw-quat placement is the correct law there and
// our open-time conversion reproduces it — truck: all 16 wheels ≤8 mm).
// On MODERN (palette-bearing) files the dev viewer's RAW-quat ROOTS are its
// own known bug: arbitrate against the file's own data.pipes endpoints
// (ISW-241: junction ports seat 0.000 m under R(qFile*), 0.18–0.29 m under
// raw — the app's law). Document any per-type finding in FORMAT — never a
// code table.
//
// usage:  cd app && node tools/wheelpair.mjs <craft-id>[,<craft-id>...]
//             [--types=Wheel|Beacon] [--corpus DIR] [--ours http://HOST:PORT]
//
// <craft-id> resolves inside the corpus (three-tier: env ARCHEAN_BLUEPRINTS >
// gitignored blueprints.conf > repo testdata) — same rule as tools/config.py.
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
const arg = (k, d) => {
  const e = args.find(s => s.startsWith(`--${k}=`));
  return e ? e.split('=').slice(1).join('=') : d;
};
const CORPUS = arg('corpus', resolveCorpus());
const TYPES = new RegExp(arg('types', 'Wheel|Beacon'));
const CRAFTS = args.filter(a => !a.startsWith('--'));
if (!CRAFTS.length) { console.error('usage: node tools/wheelpair.mjs <craft-id>[,...] [--types=Wheel|Beacon]'); process.exit(2); }

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const TOL = 0.12;   // the solo-pair box tolerance

async function devBoxes(b) {
  await page.goto(DEV, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', b);
  await page.waitForSelector('#atelier:not(.hidden)', { timeout: 120_000 });
  await page.waitForFunction(() =>
    document.getElementById('loading').classList.contains('hidden'), null, { timeout: 120_000 });
  await page.waitForFunction(() => window.__xv?.scene, null, { timeout: 60_000 });
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const out = [];
    const comps = window.__xv.model.components;
    for (const g of window.__xv.scene.layers.components.children) {
      const c = comps[g.userData.component];
      if (!c || !re.test(c.type) || !g.userData.box) continue;
      const b = g.userData.box;
      out.push({ type: c.type, fp: c.position.map(v => +v.toFixed(3)),
        min: [b.min.x, b.min.y, b.min.z].map(v => +v.toFixed(3)),
        max: [b.max.x, b.max.y, b.max.z].map(v => +v.toFixed(3)) });
    }
    return out;
  }, TYPES.source);
}

async function appBoxes(id) {
  await page.goto(`${APP}/?craft=${id}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => (window.__ARCHEAN__?.engine?.blueprint?.data?.components?.length ?? 0) > 0,
    null, { timeout: 120_000 });
  await page.waitForFunction((src) => {
    const e = window.__ARCHEAN__?.engine;
    const re = new RegExp(src);
    return (e?.blueprint?.data?.components ?? []).every((c, i) => !re.test(c.type) || !!e.compRealBox(i));
  }, TYPES.source, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return page.evaluate((src) => {
    const e = window.__ARCHEAN__.engine;
    const re = new RegExp(src);
    const out = [];
    (e.blueprint.data.components ?? []).forEach((c, ci) => {
      if (!re.test(c.type)) return;
      const b = e.compRealBox(ci);
      if (!b) return;
      out.push({ type: c.type, fp: [c.position.x, c.position.y, c.position.z].map(v => +v.toFixed(3)),
        min: b.min.map(v => +v.toFixed(3)), max: b.max.map(v => +v.toFixed(3)) });
    });
    return out;
  }, TYPES.source);
}

let fail = false;
for (const id of CRAFTS) {
  const dev = await devBoxes(resolve(CORPUS, id, 'blueprint.json'));
  const app = await appBoxes(id);
  console.error(`\ncraft ${id} (types ${TYPES.source}): dev ${dev.length}, app ${app.length}`);
  const used = new Set();
  for (const d of dev) {
    let best = -1, bd = 1e9;
    app.forEach((a, k) => {
      if (used.has(k) || a.type !== d.type) return;
      const dist = Math.hypot(a.fp[0] - d.fp[0], a.fp[1] - d.fp[1], a.fp[2] - d.fp[2]);
      if (dist < bd) { bd = dist; best = k; }
    });
    if (best < 0 || bd > 0.6) { console.log(`${d.type} @[${d.fp}] unpaired`); fail = true; continue; }
    used.add(best);
    const a = app[best];
    const dc = d.min.map((v, i) => (v + d.max[i]) / 2 - (a.min[i] + a.max[i]) / 2);
    const ds = d.min.map((v, i) => (d.max[i] - v) - (a.max[i] - a.min[i]));
    const m = Math.max(...dc.map(Math.abs), ...ds.map(Math.abs));
    if (m > TOL) fail = true;
    console.log(`${d.type.padEnd(11)} @[${d.fp.join(',')}] dCenter=[${dc.map(v => v.toFixed(3)).join(',')}] dSpan=[${ds.map(v => v.toFixed(3)).join(',')}] max=${m.toFixed(3)}${m > TOL ? '  <<< MISMATCH' : ''}`);
  }
}
console.error(`\n${fail ? 'WHEELPAIR FAIL' : 'WHEELPAIR PASS'} (tol ${TOL} m)`);
await browser.close();
process.exit(fail ? 1 : 0);
