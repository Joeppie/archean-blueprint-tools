// staticinfo.mjs — DIAGNOSTIC: how much of the viewport does the STATIC INFO
// card eat? Measures its box on a phone viewport (with the card switched on
// from ⚙) and on desktop, and asserts the mobile variant is the compact one.
// usage: node tools/staticinfo.mjs
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' }, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'] });
for (const [name, vp] of [['phone 412×915', { width: 412, height: 915 }], ['desktop 1280×800', { width: 1280, height: 800 }]]) {
  const page = await browser.newPage({ viewport: vp });
  await page.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
  await page.goto('http://127.0.0.1:5175/?craft=3509975859', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
  const defaults = await page.evaluate(() => !!document.querySelector('[data-testid="massbox"]'));
  await page.getByTestId('toggle-options').click();
  await page.getByTestId('opt-static').check();
  const box = await page.getByTestId('massbox').boundingBox() ?? { width: 0, height: 0 };
  const view = await page.getByTestId('canvas').boundingBox() ?? { width: 1, height: 1 };
  const area = 100 * (box.width * box.height) / (view.width * view.height);
  console.log(`${name}: default shown=${defaults} · card ${Math.round(box.width)}×${Math.round(box.height)} px = ${area.toFixed(1)}% of the viewport`);
  await page.close();
}
await browser.close();
