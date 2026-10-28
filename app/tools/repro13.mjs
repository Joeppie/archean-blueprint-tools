// repro13.mjs — instrumented replay of the 'run toolbar' leg's first act
// (⏹/▶ → type → dirty dot), dumping the tab-strip DOM at the check.
import { chromium } from '@playwright/test';
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
for (let round = 0; round < 3; round++) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [{ origin: BASE,
      localStorage: [{ name: 'archean-app-debug', value: '1' },
        { name: 'archean-app-backdrop', value: 'none' }] }] },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/?craft=3294880085`);
  await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
  await page.getByTestId('xenon-menu').click();
  await page.locator('[data-testid^="xenon-comp-"]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid="xenon-on"]')?.textContent === 'ON',
    null, { timeout: 90_000 });
  await page.getByTestId('ide-stop').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="xenon-on"]')?.textContent === 'OFF');
  const park = await page.evaluate(() => window.__XENON__?.().debug);
  await page.getByTestId('ide-run').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="xenon-on"]')?.textContent === 'ON');
  await page.getByTestId('xenon-tab-0').click();
  const cm = page.locator('.cm-content');
  await cm.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\nif $x > 2');
  await page.keyboard.press('Enter');
  const dump = await page.evaluate(() => ({
    tabs: [...document.querySelectorAll('[data-testid^="xenon-tab-"]')].map(b => ({
      id: b.getAttribute('data-testid'), txt: b.textContent,
      active: b.className.includes('bg-[#10141f]'),
    })),
    x: window.__XENON__?.().debug,
  }));
  console.log(`round ${round}: park was at ${park.file}:${park.line} (paused=${park.paused})`);
  console.log(`  tabs: ${JSON.stringify(dump.tabs)}`);
  console.log(`  x: paused=${dump.x.paused} at ${dump.x.file}:${dump.x.line}`);
  const dot = await page.getByTestId('xenon-tab-0').innerText();
  console.log(`  tab-0 text: ${JSON.stringify(dot)}  ${dot.includes('●') ? 'DOT-OK' : 'DOT-MISSING'}`);
  await ctx.close();
}
await browser.close();
