// gridprobe.mjs — grid-sample pressPick around doorbtn (ci 10) in the
// DASH-VIEW camera; print the hit map.
const BASE = process.argv[2] ?? 'http://127.0.0.1:5176';
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => { localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
await page.goto(`${BASE}/?craft=9000009040`);
await page.waitForFunction(() => !!window.__ARCHEAN__ && !!window.__XENON__);
await page.waitForFunction(() => window.__XENON__().farm.some(f => f.comp === 'cpu' && f.cycles > 10), null, { timeout: 60000 });
await page.evaluate(() => {
  const A = window.__ARCHEAN__; const m = A.engine.moffView;
  A.engine.auditLookAt([1.0 + m.x, 1.1 + m.y, -1.0 + m.z + 1.8], [1.0 + m.x, 1.1 + m.y, -1.0 + m.z]);
});
await page.waitForTimeout(1500);
const map = await page.evaluate(() => {
  const A = window.__ARCHEAN__; const e = A.engine; const m = e.moffView;
  const b = e.compRealBox(10);
  const c = A.screen((b.min[0]+b.max[0])/2 - m.x, (b.min[1]+b.max[1])/2 - m.y, (b.min[2]+b.max[2])/2 - m.z);
  const rows = [];
  for (let dy = -60; dy <= 60; dy += 15) {
    let row = '';
    for (let dx = -60; dx <= 60; dx += 15) {
      const p = A.pressPick(c[0] + dx, c[1] + dy);
      const q = e.pickAt(c[0] + dx, c[1] + dy);
      row += (p ? (p.ci === 10 ? 'B' : String(p.ci).slice(-1)) : '.') +
             (q.kind === 'comp' && q.ci === 10 ? 'P' : q.kind === 'comp' ? 'p' : q.kind === 'block' ? 'k' : q.kind === 'sub' ? 's' : '.');
    }
    rows.push(dy + ': ' + row);
  }
  return { c, rows, box: b };
});
console.log('centre', JSON.stringify(map.c), 'box', JSON.stringify(map.box));
console.log(map.rows.join('\n'));
await browser.close();
