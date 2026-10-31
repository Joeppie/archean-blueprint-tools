// chiposprobe.mjs — the CHIP DEV KIT census (v1.16.10): load the REAL
// ChipOS Developer's Kit (3828773626, 17 components, no fixture) with
// the whole living-craft stack and report: the four-computer farm
// (chipos + TETRIS + HELLO + EarthNAV-from-3828827922 is a separate
// craft — here the kit's three), the IDE bus rows on the chipos window,
// the power chip (kit LV battery + relay + solar-sensor census) and any
// console error. Usage: node tools/chiposprobe.mjs [baseURL]
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await page.addInitScript(() => {
  localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
});
const t0 = Date.now();
await page.goto(`${BASE}/?craft=9000009050`);
await page.waitForFunction(() => !!window.__ARCHEAN__, null, { timeout: 120_000 });
console.log('load ms', Date.now() - t0);
await page.waitForFunction(() =>
  (window.__XENON__?.()?.farm ?? []).length >= 3, null, { timeout: 120_000 })
  .catch(() => console.log('NOTE: fewer computers auto-booted than expected'));
await page.waitForFunction(() =>
  (window.__XENON__?.()?.farm ?? []).every(f => f.cycles > 40), null, { timeout: 180_000 })
  .catch(() => console.log('NOTE: farm cycles slow (EarthNAV-class compile)'));
console.log('FARM', JSON.stringify((await page.evaluate(() => window.__XENON__().farm))
  .map(f => ({ comp: f.comp, cycles: f.cycles }))));
console.log('ENERGY CHIP', JSON.stringify(
  await page.locator('[data-testid="energy-chip"]').textContent().catch(() => null)));
// the chipos IDE: open it and read its console prints (boot census, app joins)
await page.getByTestId('xenon-menu').click();
await page.getByTestId('xenon-comp-1').click();  // comps sorted: app-1 first
await page.getByTestId('xenon-on').waitFor({ timeout: 120_000 });
const prints = await page.evaluate(() =>
  (window.__XENON__().prints ?? []).map(p => String(p.v ?? '')).filter(t =>
    /ChipOS|device|APP|app/i.test(t)));
console.log('PRINTS', JSON.stringify(prints.slice(0, 10)));
console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 6)) : 'none');
await browser.close();
