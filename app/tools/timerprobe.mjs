import { chromium } from '@playwright/test';
const BASE = 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  storageState: { cookies: [], origins: [{ origin: BASE,
    localStorage: [{ name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?craft=9000008001&dash=first-virtual`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
for (const t of [2000, 3000, 3000]) {
  await page.waitForTimeout(t);
  const s = await page.evaluate(() => window.__XENON__?.());
  console.log(`status=${s?.status} cycles=${s?.cycles} raf2=${s?.raf} bus=${Object.keys(s?.bus ?? {}).length}`);
}
await browser.close();
