// spareprobe2.mjs — the SPEC's exact view: camera facing the DASHBOARD,
// then the doorbtn bbox-centre projection + pressPick + chip at that px.
const BASE = process.argv[2] ?? 'http://127.0.0.1:5177';
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
await page.goto(`${BASE}/?craft=9000009040`);
await page.waitForFunction(() => !!window.__ARCHEAN__ && !!window.__XENON__);
await page.waitForFunction(() => window.__XENON__().farm.some(f => f.comp === 'cpu' && f.cycles > 20), null, { timeout: 60000 });
// dash-view camera (the spec's leg-③ view)
await page.evaluate(() => {
  const A = window.__ARCHEAN__; const m = A.engine.moffView;
  A.engine.auditLookAt([1.0 + m.x, 1.1 + m.y, -1.0 + m.z + 1.8], [1.0 + m.x, 1.1 + m.y, -1.0 + m.z]);
});
await page.waitForTimeout(1200);
const px = await page.evaluate(() => {
  const A = window.__ARCHEAN__; const e = A.engine; const m = e.moffView;
  const b = e.compRealBox(10);
  return A.screen((b.min[0]+b.max[0])/2 - m.x, (b.min[1]+b.max[1])/2 - m.y, (b.min[2]+b.max[2])/2 - m.z);
});
console.log('px', JSON.stringify(px));
console.log('pressPick direct', JSON.stringify(await page.evaluate(([x,y]) => window.__ARCHEAN__.pressPick(x,y), px)));
console.log('pressPick INT', JSON.stringify(await page.evaluate(([x,y]) => window.__ARCHEAN__.pressPick(x,y), [Math.round(px[0]), Math.round(px[1])])));
console.log('canvas rect', JSON.stringify(await page.evaluate(() => { const r = document.querySelector('[data-testid="canvas"]').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })));
await page.evaluate(([x,y]) => {
  const cv = document.querySelector('[data-testid="canvas"]');
  cv.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true, pointerType: 'mouse' }));
}, px);
await page.waitForTimeout(300);
console.log('after synthetic move: chip display =', await page.evaluate(() => document.querySelector('[data-testid="press-chip"]')?.style.display), JSON.stringify(await page.evaluate(() => (document.querySelector('[data-testid="press-chip"]')?.textContent ?? '').slice(0, 55))));
// first hover the DASH toggle so the chip paints a known label
const dpx = await page.evaluate(() => window.__ARCHEAN__.screen(0.25, 0.85, -0.985));
await page.mouse.move(dpx[0], dpx[1]);
await page.waitForTimeout(300);
console.log('dash chip', JSON.stringify(await page.evaluate(() => document.querySelector('[data-testid="press-chip"]')?.style.display + ' | ' + (document.querySelector('[data-testid="press-chip"]')?.textContent ?? '').slice(0, 40))));
await page.mouse.move(px[0], px[1]);
await page.waitForTimeout(400);
console.log('cursor', await page.evaluate(() => document.querySelector('[data-testid="canvas"]').style.cursor));
console.log('chip visible?', await page.evaluate(() => document.querySelector('[data-testid="press-chip"]')?.style.display));
console.log('chip', JSON.stringify(await page.evaluate(() => document.querySelector('[data-testid="press-chip"]')?.textContent)));
await browser.close();
