// livingprobe.mjs — drive the LIVE BENCH craft (9000009040) in a real
// browser and dump what the press path produced: farm, worldsim rows,
// pump reads, bus. Usage: node tools/livingprobe.mjs [baseURL]
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
});
await page.goto(`${BASE}/?craft=9000009040`);
await page.waitForFunction(() => !!window.__ARCHEAN__ && !!window.__XENON__);
await page.waitForFunction(() => window.__XENON__().farm.some(f => f.comp === 'cpu' && f.cycles > 20),
  null, { timeout: 60_000 });
console.log('farm', JSON.stringify(await page.evaluate(() => window.__XENON__().farm)));

const pt = await page.evaluate(() => {
  const A = window.__ARCHEAN__;
  const m = A.engine.moffView;
  A.engine.auditLookAt([1.0 + m.x, 1.1 + m.y, -1.0 + m.z + 1.8], [1.0 + m.x, 1.1 + m.y, -1.0 + m.z]);
  return null;
});
await page.waitForTimeout(1200);
const sp = await page.evaluate(() => window.__ARCHEAN__.screen(0.25, 0.85, -0.985));
console.log('screen px', JSON.stringify(sp));
const hit = await page.evaluate(([x, y]) => window.__ARCHEAN__.pressPick(x, y), sp);
console.log('pressPick', JSON.stringify(hit));
await page.mouse.move(sp[0], sp[1]);
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(1500);
console.log('reads', JSON.stringify(await page.evaluate(() => window.__XENON__().reads())));
console.log('hingeQ', JSON.stringify(await page.evaluate(() =>
  window.__ARCHEAN__.jointPoseQ(4, 'axle'))));
// leg 4: the screen face — the 3-D feed must be LIVE (open the ▣ Screens
// dock so setScreenFeeds registers the face) before it maps pixels.
await page.getByTestId('screens-btn').click();
await page.waitForTimeout(1500);
const rp = await page.evaluate(() => window.__ARCHEAN__.screen(1.0, 1.4467, -0.9845));
console.log('rect px', JSON.stringify(rp));
const rhit = await page.evaluate(([x, y]) => window.__ARCHEAN__.pressPick(x, y), rp);
console.log('rect pressPick', JSON.stringify(rhit));
await page.mouse.move(rp[0], rp[1]);
const chip = await page.evaluate(() =>
  document.querySelector('[data-testid="press-chip"]')?.textContent ?? null);
console.log('chip', JSON.stringify(chip));
await page.mouse.down();
await page.mouse.up();
await page.waitForTimeout(1200);
console.log('prints', JSON.stringify(await page.evaluate(() => window.__XCDBG__.prints())));
await browser.close();
