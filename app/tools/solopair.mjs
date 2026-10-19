// solopair.mjs — SOLO-component geometry-space pair: XenonViewer vs our app.
//
// One component per craft (tools/make_solo_test.py, ids 90000030NN), rendered
// in BOTH viewers at the dev's iso angle (az 0.9 el 0.45; identity-orientation
// solos ⇒ the two silhouettes are directly comparable). Screenshots clip to
// the CANVAS rect (no page furniture can poison the masks); the app hides its
// ground plane + grid + selection first. Per type the routine records:
//   • reports/solo/<Type>-dev.png / <Type>-app.png
//   • the component's LOCAL content bbox in each viewer (world bbox inverse-
//     transformed by the component's own matrix — basis/convention-free:
//     equal boxes ⇔ equal content map),
//   scored afterwards by tools/solo_verify.py (silhouette IoU + box check).
// This is the ritual that arbitrated the engine content basis (2026-10-19,
// FORMAT §Component VERTEX SPACE) — re-run after game updates / loader work.
//
// usage:  cd app && node tools/solopair.mjs [--types=Aileron,SolarPanel]
//                                               [--limit N] [--no-dev]
import { chromium } from '@playwright/test';
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEV = 'https://viewer.xenontools.dev/';
const APP = process.env.OURS ?? 'http://127.0.0.1:5175';
const OUT = resolve(REPO, 'reports/solo');
// corpus root = the same three-tier resolution as tools/config.py (env >
// gitignored blueprints.conf > repo testdata) — never a hardcoded path
function resolveCorpus() {
  if (process.env.ARCHEAN_BLUEPRINTS) return resolve(process.env.ARCHEAN_BLUEPRINTS);
  const conf = resolve(REPO, 'blueprints.conf');
  if (existsSync(conf)) {
    const m = /^\s*blueprints\s*=\s*(.+)$/m.exec(readFileSync(conf, 'utf8'));
    if (m) return m[1].trim();
  }
  return resolve(REPO, 'testdata');
}
const CORPUS = process.env.CORPUS ?? resolveCorpus();
const args = process.argv.slice(2);
const arg = (k, d) => {
  const i = args.indexOf(`--${k}`);
  if (i >= 0 && args[i + 1] !== undefined) return args[i + 1];
  const e = args.find(s => s.startsWith(`--${k}=`));
  return e ? e.split('=')[1] : d;
};
const only = (arg('types', '') || '').split(',').filter(Boolean);
const LIMIT = +(arg('limit', '0'));
const DO_DEV = !args.includes('--no-dev');
const ISO = { az: 0.9, el: 0.45 };
const ISO_DIR = [Math.cos(ISO.el) * Math.sin(ISO.az), Math.sin(ISO.el), Math.cos(ISO.el) * Math.cos(ISO.az)];

mkdirSync(OUT, { recursive: true });

const fixtures = [];
for (const dir of readdirSync(CORPUS).filter(d => /^9000003\d{3}$/.test(d)).sort()) {
  const bp = JSON.parse(readFileSync(resolve(CORPUS, dir, 'blueprint.json'), 'utf8'));
  const type = bp.data.components[0]?.type;
  if (type) fixtures.push({ id: dir, type });
}
const todo = (only.length ? fixtures.filter(f => only.includes(f.type)) : fixtures)
  .slice(0, LIMIT || undefined);

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
let page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
async function revive() {          // chromium can die mid-marathon (GPU reset)
  try { await page.evaluate(() => 1); return; }
  catch {
    console.error('  [revive] relaunching browser');
    try { await page.close(); } catch { /* dead */ }
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  }
}
async function canvasClip() {      // screenshot ONLY the 3D canvas rect
  return page.evaluate(() => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width > 300 && r.height > 300 && (!best || r.width * r.height > best.width * best.height)) {
        best = { x: r.x, y: r.y, width: r.width, height: r.height };
      }
    }
    return best;
  });
}

async function devShot(f) {
  await page.goto(DEV, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', resolve(CORPUS, f.id, 'blueprint.json'));
  await page.waitForSelector('#atelier:not(.hidden)', { timeout: 90_000 });
  await page.waitForFunction(() =>
    document.getElementById('loading').classList.contains('hidden') &&
    /status-dot (ok|idle|error)/.test(document.getElementById('status-dot').className),
  null, { timeout: 90_000 });
  if ((await page.getAttribute('#status-dot', 'class')).includes('error'))
    throw new Error(`dev status: ${await page.textContent('#status-text')}`);
  await page.waitForTimeout(1500);
  await page.click('[data-view="iso"]');
  const fold = page.locator('details.sp-fold:has(#scene-options)');
  if ((await fold.getAttribute('open')) === null) await fold.locator('summary').click();
  for (const label of ['ground grid', 'shadows']) {
    const row = page.locator('#scene-options .opt-row', { hasText: label });
    if (await row.count() && await row.evaluate(r => r.classList.contains('on'))) await row.click();
  }
  await page.waitForTimeout(1000);
  const clip = await canvasClip();
  await page.screenshot({ path: resolve(OUT, `${f.type}-dev.png`), clip: clip ?? undefined });
  return page.evaluate(() => {
    const groups = window.__xv.scene.layers.components.children;
    const g = groups.find(o => o.userData.component === 0);
    if (!g || !g.userData.box) return null;
    const e = g.matrix.elements, b = g.userData.box, invM = (x, y, z) => {
      const dx = x - e[12], dy = y - e[13], dz = z - e[14];
      return [e[0] * dx + e[1] * dy + e[2] * dz, e[4] * dx + e[5] * dy + e[6] * dz, e[8] * dx + e[9] * dy + e[10] * dz];
    };
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      const p = invM(x, y, z);
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    }
    return { min: mn.map(v => +v.toFixed(3)), max: mx.map(v => +v.toFixed(3)) };
  });
}

async function appShot(f) {
  await page.goto(`${APP}/?craft=${f.id}`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  // solo fixtures have no hull blocks → the SCENE PASS title gate may not
  // fire; wait on the blueprint + the real model instead
  await page.waitForFunction(() => (window.__ARCHEAN__?.engine?.blueprint?.data?.components?.length ?? 0) > 0,
    null, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const e = window.__ARCHEAN__?.engine;
    return !!e && !!e.compRealBox(0);
  }, null, { timeout: 90_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate((dir) => {
    const e = window.__ARCHEAN__.engine;
    // silhouette hygiene (mirrors devscrape on the legacy viewer): grid,
    // ground plane, selection glow/gizmo all out
    for (const c of e.scene.children) if (c.type === 'GridHelper') c.visible = false;
    for (const o of e.root.children) if (o.userData?.kind === 'ground') o.visible = false;
    if (e.select) e.select(-1);
    const t = e.controls.target.clone();
    const dist = e.camera.position.distanceTo(t);
    e.camera.position.copy(t).add(new (e.camera.position.constructor)(...dir).multiplyScalar(dist));
    e.controls.update();
    e.invalidate();
  }, ISO_DIR);
  await page.waitForTimeout(600);
  const clip = await page.getByTestId('canvas').boundingBox();
  await page.screenshot({ path: resolve(OUT, `${f.type}-app.png`), clip: clip ?? undefined });
  return page.evaluate(() => {
    const e = window.__ARCHEAN__.engine;
    const b = e.compRealBox(0);
    if (!b) return null;
    const root = (e.compRoots.get(0) ?? []).find(o => o.visible);
    if (!root) return null;
    const inv = new (root.matrix.constructor)()
      .compose(root.position, root.quaternion, new (root.position.constructor)(1, 1, 1)).invert();
    const el = inv.elements;
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
      const px = el[0] * x + el[4] * y + el[8] * z + el[12];
      const py = el[1] * x + el[5] * y + el[9] * z + el[13];
      const pz = el[2] * x + el[6] * y + el[10] * z + el[14];
      for (const [k, v] of [[0, px], [1, py], [2, pz]]) { mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v); }
    }
    return { min: mn.map(v => +v.toFixed(3)), max: mx.map(v => +v.toFixed(3)) };
  });
}

const report = [];
for (const f of todo) {
  const row = { id: f.id, type: f.type };
  for (const [side, fn] of DO_DEV ? [['dev', devShot], ['app', appShot]] : [['app', appShot]]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await revive(); row[side] = await fn(f); break; }
      catch (err) { row[side] = `ERR ${String(err.message).slice(0, 60)}`; await revive(); }
    }
  }
  report.push(row);
  console.error(`[${report.length}/${todo.length}] ${f.type}: ` +
    `${row.dev?.min ? 'dev✓' : row.dev ?? '—'} ${row.app?.min ? 'app✓' : row.app ?? ''}`);
  writeFileSync(resolve(OUT, 'solo.json'), JSON.stringify(report, null, 1));   // crash-safe stream
}
await browser.close();
console.error(`done → ${resolve(OUT, 'solo.json')}`);
