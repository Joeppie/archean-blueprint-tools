import { chromium } from '@playwright/test';
const BASE = process.argv[2];
const browser = await chromium.launch({ args: ['--use-gl=angle','--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(() => {
  localStorage.setItem('archean-app-backdrop', 'none');
  localStorage.setItem('archean-app-debug', '1');
});
await page.goto(`${BASE}/?craft=3294880085`);
await page.waitForFunction(() => document.title.includes('SCENE PASS'), null, { timeout: 90_000 });
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.getByTestId('xenon-on').waitFor({ timeout: 60_000 });
await page.locator('.cm-content .cm-line').first().waitFor();
await page.waitForTimeout(1500);
console.log('lines', await page.locator('.cm-content .cm-line').count());
console.log('spans', await page.evaluate(() => document.querySelectorAll('.cm-content .cm-line span[class]').length));
console.log('line1', JSON.stringify((await page.locator('.cm-content .cm-line').first().textContent())?.slice(0, 70)));
console.log('tabs', JSON.stringify(await page.locator('[data-testid^="xenon-tab-"]').allTextContents()));
await browser.close();
