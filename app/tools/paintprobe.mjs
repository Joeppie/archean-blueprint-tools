import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
for (const url of ['http://127.0.0.1:5188/', 'http://127.0.0.1:5188/?craft=9000005001']) {
  for (let i = 0; i < 2; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => { localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const p = await page.evaluate(() => ({
      fp: Math.round(performance.getEntriesByType('paint').find(e => e.name === 'first-paint')?.startTime ?? -1),
      fcp: Math.round(performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint')?.startTime ?? -1),
      lcp: Math.round(performance.getEntriesByType('largest-contentful-paint').at(-1)?.startTime ?? -1),
    }));
    console.log(url.replace('http://127.0.0.1:5188', '/'), JSON.stringify(p));
    await ctx.close();
  }
}
await browser.close();
