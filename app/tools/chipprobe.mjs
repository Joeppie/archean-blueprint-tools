// chipprobe.mjs — hover doorbtn, capture page console + the chip after.
const BASE = 'http://127.0.0.1:5176';
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || t.includes('setsf')) console.log('PAGE-' + m.type().toUpperCase(), t.slice(0, 300)); });
page.on('pageerror', e => console.log('PAGE-EXC', String(e).slice(0, 400)));
await page.addInitScript(() => { localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
await page.goto(`${BASE}/?craft=9000009040`);
await page.waitForFunction(() => !!window.__ARCHEAN__ && !!window.__XENON__);
await page.waitForFunction(() => window.__XENON__().farm.some(f => f.comp === 'cpu' && f.cycles > 10), null, { timeout: 60000 });
await page.evaluate(() => {
  const A = window.__ARCHEAN__; const m = A.engine.moffView;
  A.engine.auditLookAt([1.0 + m.x, 1.1 + m.y, -1.0 + m.z + 1.8], [1.0 + m.x, 1.1 + m.y, -1.0 + m.z]);
});
await page.waitForTimeout(1200);
// open the Screens dock (the spec's leg-4 preamble)
await page.getByTestId('screens-btn').click();
await page.waitForTimeout(2500);
const scr = await page.evaluate(() => window.__ARCHEAN__.engine.screenFeedState());
console.log('screenFeedState', JSON.stringify(scr));
const sp = await page.evaluate(() => {
  const A = window.__ARCHEAN__; const m = A.engine.moffView;
  return A.screen(1.0, 1.4467, -0.9845);
});
console.log('sp', JSON.stringify(sp));
console.log('pressPick@sp', JSON.stringify(await page.evaluate(([x,y]) => window.__ARCHEAN__.pressPick(x,y), sp)));
console.log('dash-tagged meshes:', JSON.stringify(await page.evaluate(() => {
  const e = window.__ARCHEAN__.engine; const out = [];
  e.scene.traverse(o => { if (o.userData?.dash) out.push(o.userData.dash); });
  return out;
})));
const bpt = await page.evaluate(() => {
  const A = window.__ARCHEAN__; const e = A.engine; const m = e.moffView;
  const b = e.compRealBox(10);
  const c = A.screen((b.min[0]+b.max[0])/2 - m.x, (b.min[1]+b.max[1])/2 - m.y, (b.min[2]+b.max[2])/2 - m.z);
  const cv = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
  const offs = [0, 10, -10, 20, -20, 30, -30, 40, -40];
  for (const dy of offs)
    for (const dx of offs) {
      const x = c[0] + dx, y = c[1] + dy;
      if (x < cv.left + 2 || x > cv.right - 2 || y < cv.top + 2 || y > cv.bottom - 2) continue;
      if (A.pressPick(x, y)?.ci === 10) return [x, y];
    }
  return c;
});
console.log('bpt', JSON.stringify(bpt));
await page.mouse.move(bpt[0], bpt[1]);
await page.waitForTimeout(500);
console.log('chip display', await page.evaluate(() => document.querySelector('[data-testid="press-chip"]')?.style.display));
console.log('chip', JSON.stringify(await page.evaluate(() => document.querySelector('[data-testid="press-chip"]')?.textContent ?? null)));
await browser.close();
