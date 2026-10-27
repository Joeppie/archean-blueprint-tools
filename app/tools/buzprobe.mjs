// buzprobe.mjs — triage the BUZZER law on Chip's Mario: opens the IDE Bus
// tab, samples the game-* bus keys + the buzzer card rows over ~40 s.
//   node tools/buzprobe.mjs   (APP_URL=... default dev 5175)
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
for (let i = 0; i < 60; i++) {
  // MASH the jump key on the Bus tab (arms the pilot keys): the title DEMO
  // is silent and pre-assetsready input is swallowed — sprite caching runs
  // ONE sprite per cycle, so assets-ready can take a minute of cycles.
  await page.keyboard.down('f');
  await page.waitForTimeout(60);
  await page.keyboard.up('f');
  await page.waitForTimeout(1040);
  if (i % 5 === 4) {
    const s = await page.evaluate(() => window.__XENON__?.());
    const g = (s?.bus ?? []).filter(([k]) => /game-melody|game-bass/i.test(k));
    const row = await page.getByTestId('buzzer-row-game-melody').locator('span').nth(1)
      .innerText().catch(() => 'n/a');
    const using = (s?.world ?? []).find((r) => /using/.test(r.name));
    console.log(`i=${i} cycles=${s?.cycles} melodyRow=${row} using=${JSON.stringify(using)} bus=${JSON.stringify(g.slice(0, 4))}`);
    if (parseFloat(row) > 0) break;
  }
}
await browser.close();
