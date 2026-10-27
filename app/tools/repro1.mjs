import { chromium } from '@playwright/test';
const PORT = 5188, URL = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=vulkan'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 },
  storageState: { cookies: [], origins: [{ origin: URL, localStorage: [
    { name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }]}]} });
const page = await ctx.newPage();
await page.goto(URL + '/');
await page.getByTestId('gallery-new').click();
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 30000 });
await page.getByTestId('mode-edit').click();
await page.getByTestId('ws-blocks').click();
const probe = () => page.evaluate(() => {
  const c = document.querySelector('canvas'), r = c.getBoundingClientRect();
  const e = window.__ARCHEAN__.engine;
  for (let fy = 0.3; fy <= 0.8; fy += 0.02)
    for (let fx = 0.25; fx <= 0.8; fx += 0.02) {
      const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
      if (h && h.kind === 'comp') return { x: r.left + r.width * fx, y: r.top + r.height * fy,
        rect: [r.left, r.top, r.width, r.height] };
    }
  return null;
});
let px = null;
for (let i = 0; i < 40 && !px; i++) { px = await probe(); if (!px) await page.waitForTimeout(300); }
console.log('px', JSON.stringify(px));
await page.mouse.click(px.x, px.y);
await page.getByTestId('modebox').waitFor();
const st = await page.evaluate(() => window.__ARCHEAN__.engine.gizmoState());
console.log('gizmo ci', st.ci, 'mode', st.mode);
console.log('block-brush visible', await page.getByTestId('block-brush').isVisible());
await page.getByTestId('ws-edit').click();
const px2 = await probe();
console.log('px2', JSON.stringify(px2));
const rect2 = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
console.log('canvas after ws-edit', JSON.stringify(rect2));
await page.mouse.click(px2.x, px2.y);
await page.waitForTimeout(600);
const sel = await page.evaluate(() => window.__ARCHEAN__.sel());
const ws = await page.evaluate(() => [...document.querySelectorAll('[data-testid^=ws-]')].map(b => `${b.dataset.testid}:${b.getAttribute('aria-pressed')}`).join(' '));
console.log('sel', JSON.stringify(sel), '· ws', ws);
await browser.close();
