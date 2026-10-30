// flatdash.mjs — occlusion census for the front dashboards of a craft, from
// a pilot's-eye position (we: "I should see the dashboards from a position
// just over the chair, looking towards the frontal dashboards near the
// buzzers — the blocks the triangles replaced never obscured them").
// For every Dashboard component it projects the BOARD CENTRE (world =
// position + R(q)·(w/2,h/2,0), RAW quat — the placement law) to screen px
// and runs the engine's OWN pick law there: kind 'comp' = the dashboard (or
// its elements) is what the eye hits; 'tri' = a skin record occludes it;
// 'block' = a block does. Runs the census in BOTH display modes (prism
// default + opt-flatskin) and shoots a screenshot per mode.
//   (dev server on :5175)  cd app && node tools/flatdash.mjs [craftId] [--eye=x,y,z] [--tgt=x,y,z]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const CRAFT = args.find(a => !a.startsWith('--')) ?? '3326372833';
const get = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? d;
const URL0 = get('url', 'http://127.0.0.1:5175');
const eye = (get('eye', '0,2.45,-1.85')).split(',').map(Number);
const tgt = (get('tgt', '0,2.1,-3.2')).split(',').map(Number);

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 1400, height: 840 },
  storageState: { cookies: [], origins: [{ origin: new URL(URL0).origin,
    localStorage: [{ name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto(`${URL0}/?craft=${CRAFT}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ARCHEAN__?.stats?.()?.comps >= 0, null, { timeout: 60000 });
await page.waitForTimeout(2500);   // real models + generated dashboards in

const census = async (label) => {
  await page.evaluate(([e, t]) => {
    const m = window.__ARCHEAN__.engine.moff ?? { x: 0, y: 0, z: 0 };
    window.__ARCHEAN__.engine.auditLookAt(
      [e[0] + m.x, e[1] + m.y, e[2] + m.z], [t[0] + m.x, t[1] + m.y, t[2] + m.z]);
  }, [eye, tgt]);
  await page.waitForTimeout(700);
  const rows = await page.evaluate(() => {
    const A = window.__ARCHEAN__, eng = A.engine;
    const bp = eng.blueprint;
    const rot = (q, v) => {   // RAW quaternion law: world = position + R(q)·local
      const { w, x, y, z } = q;
      const r = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
      return [0, 1, 2].map(i => r[i][0] * v[0] + r[i][1] * v[1] + r[i][2] * v[2]);
    };
    const out = [];
    bp.data.components.forEach((c, ci) => {
      if (c.type !== 'Dashboard') return;
      const w = (c.data?.size_x ?? 0) / 100, h = (c.data?.size_y ?? 0) / 100;
      const off = rot(c.orientation, [w / 2, h / 2, 0.015]);   // element plane height
      const p = [0, 1, 2].map(i => c.position[['x', 'y', 'z'][i]] + off[i]);
      const s = eng.screenPoint(p[0], p[1], p[2]);   // already CLIENT px
      if (!s) { out.push({ ci, vis: 'offscreen', p: p.map(v => +v.toFixed(2)) }); return; }
      const r = eng.pickCell(s[0], s[1]);
      out.push({ ci, vis: r?.kind ?? 'none', ciHit: r?.ci ?? -1,
        p: p.map(v => +v.toFixed(2)),
        dHit: r ? +Math.hypot(r.point[0] - p[0], r.point[1] - p[1], r.point[2] - p[2]).toFixed(3) : null });
    });
    return out;
  });
  console.log(`\n=== ${label} — board-centre pick census (eye ${eye} → ${tgt}) ===`);
  for (const r of rows)
    console.log(`  dash#${r.ci} at ${JSON.stringify(r.p)}: first hit ${r.vis}` +
      (r.ciHit >= 0 ? ` (comp#${r.ciHit})` : '') + (r.dHit != null ? ` off ${r.dHit} m` : ''));
  await page.screenshot({ path: `/tmp/opencode/flatdash-${label.replace(/\W+/g, '_')}.png` });
  console.log(`  shot: /tmp/opencode/flatdash-${label.replace(/\W+/g, '_')}.png`);
  return rows;
};

const a = await census('prism');
await page.getByTestId('toggle-options').click();   // open the ⚙ View popover
await page.getByTestId('opt-flatskin').check();
await page.waitForTimeout(700);
const b = await census('flat');

const tally = (rows) => {
  const t = {};
  for (const r of rows) t[r.vis] = (t[r.vis] ?? 0) + 1;
  return t;
};
console.log('\nprism:', JSON.stringify(tally(a)), '\nflat: ', JSON.stringify(tally(b)));
await browser.close();
