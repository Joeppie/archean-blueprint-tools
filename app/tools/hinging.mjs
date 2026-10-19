// hinging.mjs — DIAGNOSTIC: is the subgrid hinge UI (the ring/arrow at the
// joint line) actually AT its master part on screen? Selects each SUBGRID with
// a kinematic master and compares the handle's screen grab point with the
// master part's own projected position. A z-mirrored clamp line put the handle
// metres (Jimmy: 30 m) away from the part it controls.
// usage: node tools/hinging.mjs <craft-id>[,...]
import { chromium } from '@playwright/test';
const crafts = process.argv.slice(2).flatMap(a => a.split(',')).filter(a => a && !a.startsWith('--'));
if (!crafts.length) { console.error('usage: node tools/hinging.mjs <craft-id>[,...]'); process.exit(2); }
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
for (const craft of crafts) {
  await page.goto(`http://127.0.0.1:5175/?craft=${craft}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
  await page.getByTestId('mode-edit').click();
  await page.waitForTimeout(400);
  const rows = await page.evaluate(() => {
    const e = window.__ARCHEAN__.engine;
    const out = [];
    for (const [bi, jrefs] of e.subJrefs) {
      const m = jrefs.find(r => r.top >= 0);
      if (!m) continue;
      e.selectSub(bi);
      const info = e.hingeInfo();
      if (!info || !info.handles.length) { out.push({ bi, top: m.top, type: m.mc.type, handles: 0 }); continue; }
      const pt = e.hingeScreenPoint(0);
      // the master part's own screen position (its display root projected)
      e.scene.updateMatrixWorld(true);
      const roots = (e.compRoots.get(m.top) ?? []).filter(o => o.visible);
      const v = (roots[0] ?? roots[0]).position.clone().project(e.camera);
      const box = e.renderer.domElement.getBoundingClientRect();
      const part = { x: (v.x * 0.5 + 0.5) * box.width + box.left, y: (-v.y * 0.5 + 0.5) * box.height + box.top };
      out.push({
        bi, top: m.top, type: m.mc.type, kind: info.handles[0].kind, handles: info.handles.length,
        px: pt && +pt.x.toFixed(1), py: pt && +pt.y.toFixed(1),
        partx: +part.x.toFixed(1), party: +part.y.toFixed(1),
        dpx: pt ? +Math.hypot(pt.x - part.x, pt.y - part.y).toFixed(1) : null,
        onScreen: pt ? v.z < 1 : false,
      });
    }
    return out;
  });
  console.log(`\n${craft}`);
  for (const r of rows) {
    if (!r.handles) { console.log(`  sub#${r.bi} m#${r.top} ${r.type}: NO hinge handle`); continue; }
    console.log(`  sub#${r.bi} m#${r.top} ${r.type} [${r.kind}] handle at (${r.px}, ${r.py}) vs part (${r.partx}, ${r.party}) → ${r.dpx} px apart` +
      (r.onScreen && r.dpx > 220 ? '   <<< HANDLE FAR FROM ITS PART' : ''));
  }
}
await browser.close();
