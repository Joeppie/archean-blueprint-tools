// codeprobe.mjs — after flyTo(2), where is cpu's model and what does a
// click at its bbox centre pick? Does the modebox open?
const BASE = process.argv[2] ?? 'http://127.0.0.1:5175';
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
await page.goto(`${BASE}/?craft=9000009040`);
await page.waitForFunction(() => !!window.__ARCHEAN__ && !!window.__XENON__);
await page.waitForFunction(() => window.__XENON__().farm.some(f => f.comp === 'cpu' && f.cycles > 10), null, { timeout: 60000 });
await page.getByTestId('mode-edit').click();   // Modify: clicks SELECT
await page.evaluate(() => {
  const A = window.__ARCHEAN__; const e = A.engine; const m = e.moffView;
  const b = e.compRealBox(2);
  const c = [(b.min[0]+b.max[0])/2, (b.min[1]+b.max[1])/2, (b.min[2]+b.max[2])/2];
  e.auditLookAt([c[0]+m.x, c[1]+m.y+0.4, c[2]+m.z+1.6], [c[0]+m.x, c[1]+m.y, c[2]+m.z]);
});
await page.waitForTimeout(1500);
const r = await page.evaluate(() => {
  const A = window.__ARCHEAN__; const e = A.engine; const m = e.moffView;
  const b = e.compRealBox(2);
  const px = A.screen((b.min[0]+b.max[0])/2 - m.x, (b.min[1]+b.max[1])/2 - m.y, (b.min[2]+b.max[2])/2 - m.z);
  const hit = px ? e.pickAt(px[0], px[1]) : null;
  const cell = px ? e.pickCell?.(px[0], px[1]) : null;
  globalThis.__cell = cell;
  const cv = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
  return { b, px, hit, canvas: [cv.left, cv.top, cv.width, cv.height], cam: e.camPos() };
});
console.log('box2', JSON.stringify(r.b));
console.log('px', JSON.stringify(r.px), 'canvas', JSON.stringify(r.canvas));
console.log('pickAt', JSON.stringify(r.hit));
console.log('pickCell', JSON.stringify(await page.evaluate(() => {
  const e = window.__ARCHEAN__.engine; const m = e.moffView;
  const b = e.compRealBox(2);
  const px = window.__ARCHEAN__.screen((b.min[0]+b.max[0])/2 - m.x, (b.min[1]+b.max[1])/2 - m.y, (b.min[2]+b.max[2])/2 - m.z);
  return e.pickCell(px[0], px[1]);
})));
if (r.px && r.hit?.kind === 'comp') {
  await page.mouse.click(r.px[0], r.px[1]);
  await page.waitForTimeout(400);
  console.log('modebox', await page.evaluate(() => !!document.querySelector('[data-testid="modebox"]')));
  console.log('mode-code', await page.evaluate(() => !!document.querySelector('[data-testid="mode-code"]')));
  console.log('sel', JSON.stringify(await page.evaluate(() => window.__ARCHEAN__.sel())));
}
await browser.close();
