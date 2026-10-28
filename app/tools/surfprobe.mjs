// surfprobe.mjs — dump Mario's surface list (keys + sizes) + buzzer bus.
//   node tools/surfprobe.mjs   (APP_URL=... default dev 5175)
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
await page.getByTestId('xenon-side-bus').click();
// mash jump so the game boots (title demo is silent, pre-assetsready swallows input)
for (let i = 0; i < 40; i++) {
  await page.keyboard.down('f');
  await page.waitForTimeout(60);
  await page.keyboard.up('f');
  await page.waitForTimeout(1040);
  const s = await page.evaluate(() => window.__XENON__?.());
  if (i === 2) for (const m of s?.surfaceMeta ?? []) console.log('SURFACE', m.key, `${m.w}x${m.h}`);
  const g = (s?.bus ?? []).filter(([k]) => /game-melody|game-bass/.test(k));
  if (g.some(([, v]) => Number(v) > 1)) {
    console.log(`music live @i=${i}: ${JSON.stringify(g)}`);
    break;
  }
}
await browser.close();
