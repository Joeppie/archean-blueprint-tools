// spareprobe.mjs — where is 'doorbtn' (ci 10) on screen, and what does
// pressPick say there? Drives the LIVING BENCH camera to face it.
const BASE = process.argv[2] ?? 'http://127.0.0.1:5175';
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
await page.goto(`${BASE}/?craft=9000009040`);
await page.waitForFunction(() => !!window.__ARCHEAN__ && !!window.__XENON__);
await page.waitForFunction(() => window.__XENON__().farm.some(f => f.comp === 'cpu' && f.cycles > 20), null, { timeout: 60000 });
const A = () => page.evaluate(() => window.__ARCHEAN__);
// face the SPARE BUTTON straight-on: eye at part + normal
const info = await page.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  const m = e.moffView;
  const box = e.compRealBox?.(10) ?? null;
  return { m, box };
});
console.log('moff', JSON.stringify(info.m), 'box10', JSON.stringify(info.box));
const c = info.box ? [
  (info.box.min[0] + info.box.max[0]) / 2 - info.m.x,
  (info.box.min[1] + info.box.max[1]) / 2 - info.m.y,
  (info.box.min[2] + info.box.max[2]) / 2 - info.m.z] : [1.5, 0.1, -0.9];
console.log('doorbtn world-centre (file)', JSON.stringify(c));
await page.evaluate(([cx, cy, cz, mx, my, mz]) => {
  window.__ARCHEAN__.engine.auditLookAt([cx + mx, cy + my, cz + mz + 1.2], [cx + mx, cy + my, cz + mz]);
}, [c[0], c[1], c[2], info.m.x, info.m.y, info.m.z]);
await page.waitForTimeout(1200);
const px = await page.evaluate(([x, y, z]) => window.__ARCHEAN__.screen(x, y, z), c);
console.log('screen px', JSON.stringify(px));
const hit = await page.evaluate(([x, y]) => window.__ARCHEAN__.pressPick(x, y), px);
console.log('pressPick', JSON.stringify(hit));
// press it, watch gimbals
await page.mouse.move(px[0], px[1]);
const chip = await page.evaluate(() => document.querySelector('[data-testid="press-chip"]')?.textContent);
console.log('chip', JSON.stringify(chip));
await page.mouse.down(); await page.mouse.up();
await page.waitForTimeout(2500);
const q = await page.evaluate(() => window.__ARCHEAN__.jointPoseQ(9, 'axle'));
const deg = q ? 2 * Math.acos(Math.min(1, Math.abs(q[0]))) * 180 / Math.PI : 0;
console.log('gimbals angle', deg.toFixed(1));
await browser.close();
