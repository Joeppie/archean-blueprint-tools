// subride.mjs — JOINT-LINE AUDIT + master-ride check for REAL crafts.
//
// Two questions per (subgrid, master) pair:
//  1. IS THE JOINT LINE AT THE JOINT? captureJrefs clamps the .ini axle pivot
//     onto the subgrid's panel bbox; the result must sit AT the master part
//     (lever |pivot0 − p0| ≈ the .ini joint offset, well under a metre for the
//     corpus's SmallHinge/SmallPivot/LinearTrack) and ON/IN the panel content
//     (distance from the line to the rendered panel bbox ≈ 0). A multi-metre
//     lever = a phantom joint: spinning or moving the part sweeps the panel
//     about a line that has nothing to do with the visible hinge.
//  2. DOES THE PANEL RIDE THE PART? rotate/translate the master through the
//     REAL gizmo writeback and compare the subgrid GROUP TRANSFORM with the
//     exact rigid transport of the part's own motion: (p,q) ↦ (pos + dq·(p−p0),
//     dq·q). A miss means the panel tears away from the part it is jointed to.
//
// usage: cd app && node tools/subride.mjs <craft-id>[,...] [--axis=y] [--deg=25]
//        [--only=<masterCi>] [--shots] [--mv=<metres>]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const APP = process.env.OURS ?? 'http://127.0.0.1:5175';
const args = process.argv.slice(2);
const arg = (k, d) => { const e = args.find(s => s.startsWith(`--${k}=`)); return e ? e.split('=').slice(1).join('=') : d; };
const CRAFTS = args.filter(a => !a.startsWith('--')).flatMap(a => a.split(',')).filter(Boolean);
if (!CRAFTS.length) { console.error('usage: node tools/subride.mjs <craft-id>[,...]'); process.exit(2); }
const AXIS = arg('axis', 'y');
const DEG = Number(arg('deg', 25));
const MV = arg('mv', null);
const ONLY = arg('only', null);
const SHOTS = args.includes('--shots');
const OUT = resolve(REPO, 'reports/subride');
if (SHOTS) mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  const xf = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
  window.__PROBE__ = {
    /** world AABB of a subtree {min,max} (raw matrix math, no THREE global) */
    box(root) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      root.traverse(o => {
        if (!o.isMesh || !o.visible || !o.geometry) return;
        const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox; if (!b) return;
        const m = o.matrixWorld.elements;
        for (let i = 0; i < 8; i++) {
          const p = xf(m, [(i & 1 ? b.max : b.min).x, (i & 2 ? b.max : b.min).y, (i & 4 ? b.max : b.min).z]);
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
        }
      });
      return { min: mn, max: mx };
    },
    /** distance from a point to an AABB (0 when inside) */
    dist(p, b) { return Math.hypot(...[0, 1, 2].map(k => Math.max(b.min[k] - p[k], 0, p[k] - b.max[k]))); },
  };
});

const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
const qconj = q => [q[0], -q[1], -q[2], -q[3]];
const qrot = (q, v) => {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const sub = (a, b) => a.map((v, i) => v - b[i]);
const add = (a, b) => a.map((v, i) => v + b[i]);
const len = a => Math.hypot(...a);
const spinDeg = q => 2 * Math.acos(Math.min(1, Math.abs(q[0]))) * 180 / Math.PI;

let bad = 0, n = 0;
for (const craft of CRAFTS) {
  console.log('\n' + '='.repeat(96));
  console.log(craft);
  await page.goto(`${APP}/?craft=${craft}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
  await page.getByTestId('mode-edit').click();
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.__ARCHEAN__.engine.pendingReal === 0, null, { timeout: 90_000 }).catch(() => {});

  const pairs = await page.evaluate(() => {
    const e = window.__ARCHEAN__.engine;
    const out = [];
    for (const [bi, jrefs] of e.subJrefs) for (const r of jrefs) if (r.top >= 0)
      out.push({ bi, top: r.top, type: r.mc.type, angle: r.mc.data?.angle ?? 0 });
    return out.sort((a, b) => a.bi - b.bi);
  });

  for (const pr of pairs) {
    if (ONLY !== null && pr.top !== Number(ONLY)) continue;
    n++;
    const snap = () => page.evaluate(({ bi, ci }) => {
      const e = window.__ARCHEAN__.engine, P = window.__PROBE__;
      e.scene.updateMatrixWorld(true);
      const g = e.subGroups.get(bi);
      const roots = e.compRoots.get(ci) ?? [];
      const vis = roots.filter(o => o.visible);
      const j = (e.subJrefs.get(bi) ?? []).find(r => r.top === ci);
      const moff = [e.moffView.x, e.moffView.y, e.moffView.z];
      // the panel's block bbox in the SAME world frame the group renders in
      const bl = ((e.bp.data.components[bi]?.data?.blocks) ?? []).filter(x => (x.type ?? 0) !== 255);
      const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (const x of bl) for (const s of [[0, 0, 0], [(x.size_x ?? 0) + 1, (x.size_y ?? 0) + 1, (x.size_z ?? 0) + 1]]) {
        const p = [(x.pos_x + s[0] + (x.frame_x ?? 0) * 12 - 5.5) * 0.25 + moff[0],
          (x.pos_y + s[1] + (x.frame_y ?? 0) * 12 - 5.5) * 0.25 + moff[1],
          (x.pos_z + s[2] + (x.frame_z ?? 0) * 12 - 5.5) * 0.25 + moff[2]];
        for (let k = 0; k < 3; k++) { bb.min[k] = Math.min(bb.min[k], p[k]); bb.max[k] = Math.max(bb.max[k], p[k]); }
      }
      return {
        grpP: [g.position.x, g.position.y, g.position.z],
        grpQ: [g.quaternion.w, g.quaternion.x, g.quaternion.y, g.quaternion.z],
        panel: P.box(g),
        blocks: bb,
        part: { p: [vis[0].position.x, vis[0].position.y, vis[0].position.z], q: [vis[0].quaternion.w, vis[0].quaternion.x, vis[0].quaternion.y, vis[0].quaternion.z] },
        line: j ? { p0: j.p0.map((v, i) => v + moff[i]), pivot0: j.pivot0.map((v, i) => v + moff[i]), axis0: j.axis0 } : null,
      };
    }, { bi: pr.bi, ci: pr.top });

    await page.evaluate(({ ci }) => window.__ARCHEAN__.engine.select(ci), { ci: pr.top });
    const b = await snap();
    if (MV !== null) await page.evaluate(({ axis, m }) => window.__ARCHEAN__.engine.gizmoTranslateView(axis, m), { axis: AXIS, m: Number(MV) });
    else await page.evaluate(({ axis, deg }) => window.__ARCHEAN__.engine.gizmoRotateViewDeg(axis, deg), { axis: AXIS, deg: DEG });
    if (SHOTS) await page.screenshot({ path: resolve(OUT, `${craft}-sub${pr.bi}-m${pr.top}-${AXIS}${MV ?? DEG}.png`) });
    const a = await snap();
    await page.evaluate(() => window.__ARCHEAN__.engine.select(-1));

    // (1) the joint line: at the part? on the panel?
    const lever = len(sub(b.line.pivot0, b.line.p0));
    // distance from the clamped line to the panel's BLOCK bbox (the clamp
    // target): 0 whenever the subgrid has blocks (the clamp puts it inside).
    const onPanel = b.blocks.min[0] === Infinity ? 0 : P0(b.line.pivot0, b.blocks);
    const nearPanel = b.blocks.min[0] === Infinity ? Infinity
      : Math.hypot(...[0, 1, 2].map(k => (b.blocks.min[k] + b.blocks.max[k]) / 2 - b.line.p0[k]));
    function P0(p, bx) { return Math.hypot(...[0, 1, 2].map(k => Math.max(bx.min[k] - p[k], 0, p[k] - bx.max[k]))); }
    // (2) exact rigid ride of the part's own motion
    const dq = qmul(a.part.q, qconj(b.part.q));
    const predP = add(a.part.p, qrot(dq, sub(b.grpP, b.part.p)));
    const predQ = qmul(dq, b.grpQ);
    const missP = len(sub(predP, a.grpP));
    const missQ = spinDeg(qmul(predQ, qconj(a.grpQ)));
    const travel = len(sub(a.grpP, b.grpP));
    const reasons = [];
    if (!(onPanel <= 0.6)) reasons.push(`line off panel by ${onPanel.toFixed(3)} m`);
    if (lever > 3 && nearPanel > 3) reasons.push(`phantom lever ${lever.toFixed(2)} m (panel ${nearPanel.toFixed(2)} m away)`);
    if (!(missP <= 0.02)) reasons.push(`ride ${missP.toFixed(4)} m`);
    if (!(missQ <= 0.5)) reasons.push(`spin ${missQ.toFixed(3)}°`);
    const flag = reasons.length > 0;
    if (flag) bad++;
    console.log(
      `sub#${String(pr.bi).padStart(3)} m#${String(pr.top).padStart(3)} ${pr.type.padEnd(11)} a=${String(pr.angle).padStart(6)}` +
      ` lever=${lever.toFixed(3).padStart(7)} m line→panel=${onPanel.toFixed(3).padStart(7)} m` +
      ` | ${MV ? `mv ${AXIS}${MV}m` : `spin ${AXIS}${DEG}°`} ride=${missP.toFixed(4).padStart(7)} m/${missQ.toFixed(2)}°` +
      ` panel-travel=${travel.toFixed(2)} m${flag ? '   <<< ' + reasons.join(', ') : ''}`,
    );
  }
}
console.log(`\n${n} pairs audited, ${bad} flagged`);
await browser.close();
process.exit(bad ? 1 : 0);
