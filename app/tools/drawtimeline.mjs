// drawtimeline.mjs — sample the invaders zoom canvas + program vars at
// fixed cycle marks on a given server (the v1.14.1 wasm-rebuild bisect:
// v1.13.33 draws 3129 lit px at cycle 201, v1.15.x draws 576).
//   node tools/drawtimeline.mjs <base-url>
import { chromium } from '@playwright/test';
const BASE = process.argv[2];
const browser = await chromium.launch({
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)));
await page.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
});
await page.goto(`${BASE}/?craft=3288012440&dash=main%230`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
const X = () => page.evaluate(() => (window.__XENON__ ? window.__XENON__() : null));
const lit = () => page.evaluate(() => {
  const cv = document.querySelector('[data-testid="screens-cell-main#0-fullcanvas"]');
  if (!cv) return -1;
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0, cols = {};
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
    if (l > 30) { n++; const k = `${d[i] >> 6},${d[i + 1] >> 6},${d[i + 2] >> 6}`; cols[k] = (cols[k] || 0) + 1; }
  }
  const top = Object.entries(cols).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}:${v}`);
  return { n, top };
});
for (const mark of [200, 400, 600, 900, 1300, 1800]) {
  await page.waitForFunction(m => ((window.__XENON__?.() ?? {}).cycles ?? 0) >= m,
    mark, { timeout: 120_000 }).catch(() => {});
  const x = await X();
  const l = await lit();
  const vars = Object.fromEntries(Object.entries(x.vars ?? {}).filter(([k]) =>
    /mode|state|phase|frames|score|wave|title|demo|assets/i.test(k)).map(([k, v]) => [k, v]));
  console.log(`cycles=${x.cycles} lit=${JSON.stringify(l)} vars=${JSON.stringify(vars)}`);
}
await page.screenshot({ path: `/tmp/opencode/drawtimeline-${BASE.replace(/\W+/g, '_')}.png` });
await browser.close();
