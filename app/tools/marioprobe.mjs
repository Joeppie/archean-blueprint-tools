// marioprobe.mjs — triage the cockpit bindings on Chip's Mario craft:
// prints __XENON__().pilotKeys and the bound worldsim row names.
//   node tools/marioprobe.mjs   (APP_URL=... default 127.0.0.1:5175)
import { chromium } from '@playwright/test';

const CRAFT = '3820116990';
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  storageState: { cookies: [], origins: [{ origin: BASE,
    localStorage: [{ name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?craft=${CRAFT}`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.waitForFunction(() => (window).__XENON__?.()?.status === 'running', null, { timeout: 120_000 });
await page.getByTestId('xenon-side-screens').click();
for (let i = 0; i < 10; i++) {
  const s = await page.evaluate(() => window.__XENON__?.());
  if (s?.pilotKeys?.length) {
    console.log('pilotKeys:', JSON.stringify(s.pilotKeys));
    console.log('world rows:', JSON.stringify((s.world ?? []).map(r => r.name), null, 0).slice(0, 800));
    break;
  }
  await page.waitForTimeout(3000);
}
await browser.close();
