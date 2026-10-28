// linkprobe.mjs — verify the Pages deep link opens Mario's FIRST
// virtualscreen fullscreen immediately.
//   APP_URL=<base> node tools/linkprobe.mjs
import { chromium } from '@playwright/test';

const BASE = process.env.APP_URL ?? 'https://joeppie.github.io/archean-blueprint-tools';
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
const t0 = Date.now();
await page.goto(`${BASE}/?craft=3820116990&dash=first-virtual`);
const overlay = page.getByTestId('screens-cell-virtual#0#0-overlay');
await overlay.waitFor({ state: 'visible', timeout: 120_000 });
const cv = page.getByTestId('screens-cell-virtual#0#0-fullcanvas');
await cv.waitFor({ state: 'visible', timeout: 60_000 });
// the game paints (title screen pixels)
const lit = await page.evaluate(() => {
  const c = document.querySelector('[data-testid="screens-cell-virtual#0#0-fullcanvas"]');
  if (!c) return -1;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 90) n++;
  return n;
});
const box = (await cv.boundingBox()) || { x: 0, y: 0, width: 0, height: 0 };
console.log(`overlay up after ${((Date.now() - t0) / 1000).toFixed(1)}s; canvas ${Math.round(box.width)}x${Math.round(box.height)} (ratio ${(box.width / box.height).toFixed(2)}), lit px=${lit}`);
await browser.close();
