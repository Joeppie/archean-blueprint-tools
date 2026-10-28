// benchprobe.mjs — run the bench panel's asserts and print every result.
import { chromium } from '@playwright/test';

const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  storageState: { cookies: [], origins: [{ origin: new URL(BASE).origin,
    localStorage: [{ name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?craft=9000008001&dash=first-virtual`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
await page.getByTestId('screens-cell-virtual#0#0-fullexit').click();
await page.getByTestId('screens-close').click();
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.waitForFunction(() => (window).__XENON__?.()?.status === 'running', null, { timeout: 120_000 });
await page.getByTestId('xenon-side-autotest').click();
const src = await page.getByTestId('xenon-test-src').inputValue();
const res = await page.evaluate(t => (window).__XENONTEST__.run(t), src);
console.log(JSON.stringify(res, null, 1));
console.log('SNAPSHOT', JSON.stringify(await page.evaluate(() => (window).__XENONTEST__.snapshot())).slice(0, 400));
await browser.close();
