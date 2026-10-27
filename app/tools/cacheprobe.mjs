import { chromium } from '@playwright/test';
import { rmSync, mkdirSync } from 'node:fs';
const URL = 'http://127.0.0.1:5188';
const COLD = '/tmp/opencode/mesa-cold', WARM = '/tmp/opencode/mesa-warm';
rmSync(COLD, { recursive: true, force: true }); mkdirSync(COLD, { recursive: true });
for (const [name, dir] of [['cold (fresh cache)', COLD], ['warm (shared cache)', WARM], ['warm 2nd browser', WARM]]) {
  const browser = await chromium.launch({
    env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json',
      XDG_CACHE_HOME: dir, MESA_GL_VERSION_OVERRIDE: '' },
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
  });
  const times = [], rend = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => { localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(URL + '/?craft=3812927875', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
    times.push(Date.now() - t0);
    rend.push(Math.round(await page.evaluate(() =>
      performance.getEntriesByName('boot:renderer', 'mark')[0]?.startTime ?? -1)));
    await ctx.close();
  }
  await browser.close();
  console.log(name.padEnd(22), 'passes', times.join(' '), '· renderer marks', rend.join(' '));
}
