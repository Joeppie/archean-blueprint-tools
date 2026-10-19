// jointturn.mjs — DIAGNOSTIC: does turning a joint's data.angle spin its panel
// about the VISIBLE joint line? Checks that a point ON the captured line is
// fixed by the group transform (a hinge pivots on its own pin) and that the
// content sweeps a circle about it. usage: node tools/jointturn.mjs <craft> <bi> <ci> [deg]
import { chromium } from '@playwright/test';
const [craft, biS, ciS, degS = '30'] = process.argv.slice(2);
const bi = Number(biS), ci = Number(ciS), deg = Number(degS);
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
await page.goto(`http://127.0.0.1:5175/?craft=${craft}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60000 });
await page.getByTestId('mode-edit').click();
await page.waitForTimeout(500);
await page.waitForFunction(() => window.__ARCHEAN__.engine.pendingReal === 0, null, { timeout: 90000 }).catch(() => {});

const r = await page.evaluate(({ bi, ci, deg }) => {
  const e = window.__ARCHEAN__.engine;
  const j = e.subJrefs.get(bi).find(r => r.top === ci);
  const g = e.subGroups.get(bi);
  const mo = [e.moffView.x, e.moffView.y, e.moffView.z];
  const xf = (v) => { e.scene.updateMatrixWorld(true); const m = g.matrixWorld.elements; return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]; };
  const box = () => { let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; e.scene.updateMatrixWorld(true); g.traverse(o => { if (!o.isMesh || !o.visible) return; const gg = o.geometry; if (!gg.boundingBox) gg.computeBoundingBox(); const B = gg.boundingBox, m = o.matrixWorld.elements; for (let i = 0; i < 8; i++) { const v = [(i & 1 ? B.max : B.min).x, (i & 2 ? B.max : B.min).y, (i & 4 ? B.max : B.min).z]; const p = [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]; for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); } } }); return { mn, mx, c: mn.map((v, i) => (v + mx[i]) / 2) }; };
  const line = j.pivot0.map((v, i) => v + mo[i]);
  const part = (e.compRoots.get(ci) ?? []).find(o => o.visible);
  const partP = [part.position.x, part.position.y, part.position.z];
  const before = { onLine: xf(line), box: box(), angle: j.mc.data?.angle ?? 0 };
  j.mc.data = { ...(j.mc.data ?? {}), angle: (j.mc.data?.angle ?? 0) + deg };
  e.dataEdited();
  const after = { onLine: xf(line), box: box(), angle: j.mc.data.angle };
  return { before, after, line, axis0: j.axis0, partP, type: j.mc.type };
}, { bi, ci, deg });

const sub = (a, b) => a.map((v, i) => v - b[i]);
const len = a => Math.hypot(...a);
const perp = (d, p) => { const k = d.reduce((s, x, i) => s + x * p[i], 0); return len(sub(p, d.map((x) => x * k))); };
const n0 = r.axis0.map(x => x);
console.log(`${r.type}: angle ${r.before.angle} → ${r.after.angle} (${(r.after.angle - r.before.angle).toFixed(1)}°)`);
console.log('  point ON the joint line moved', len(sub(r.before.onLine, r.after.onLine)).toFixed(4), 'm (a hinge turns ON its pin ⇒ ≈0)');
const c0 = r.before.box.c, c1 = r.after.box.c;
const rr0 = perp(n0, sub(c0, r.line)), rr1 = perp(n0, sub(c1, r.line));
console.log('  panel centre radius about the line', rr0.toFixed(3), '→', rr1.toFixed(3), 'm (equal ⇒ it circles the line)');
console.log('  panel centre travelled', len(sub(c0, c1)).toFixed(3), 'm; expected for', (r.after.angle - r.before.angle).toFixed(0) + '°:', (2 * rr0 * Math.sin(Math.abs(r.after.angle - r.before.angle) * Math.PI / 360)).toFixed(3), 'm');
console.log('  line↔part distance', len(sub(r.line, r.partP)).toFixed(3), 'm');
await browser.close();
