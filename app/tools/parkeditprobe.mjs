// parkeditprobe.mjs — the WP5 park-to-edit click, fully instrumented.
import { chromium } from '@playwright/test';
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  storageState: { cookies: [], origins: [{ origin: BASE,
    localStorage: [{ name: 'archean-app-debug', value: '1' },
      { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.goto(`${BASE}/?craft=3294880085`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.waitForFunction(() => document.querySelector('[data-testid="xenon-on"]')?.textContent === 'ON',
  null, { timeout: 90_000 });
await page.getByTestId('xenon-side-vars').click();
await page.waitForTimeout(1200);
const press = page.locator('[data-testid^="xenon-valpress-"]').first();
console.log('press rows =', await page.locator('[data-testid^="xenon-valpress-"]').count());
console.log('press testid =', await press.getAttribute('data-testid'));
await press.click();
await page.waitForFunction(() => window.__XENON__?.().paused === true, null, { timeout: 8000 });
console.log('parked:', JSON.stringify((await page.evaluate(() => window.__XENON__?.()))?.debug));
for (const ms of [200, 1000, 3000]) {
  await page.waitForTimeout(ms);
  const d = await page.evaluate(() => ({
    edits: [...document.querySelectorAll('[data-testid^="xenon-edit-"]')].map(e => e.getAttribute('data-testid')),
    vals: [...document.querySelectorAll('[data-testid^="xenon-val-"]')].slice(0, 6).map(e => e.getAttribute('data-testid')),
    side: [...document.querySelectorAll('[data-testid^="xenon-side-"]')].find(b => b.className.includes('bg-[#1d2b42]'))?.getAttribute('data-testid'),
  }));
  console.log(`+${ms}ms: edits=${JSON.stringify(d.edits)} side=${d.side} firstVals=${JSON.stringify(d.vals)}`);
}
await browser.close();
