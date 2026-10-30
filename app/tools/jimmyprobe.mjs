// jimmyprobe.mjs — THE JIMMY CENSUS (v1.16.10 WP7, workpackages batch
// 2026-10-30/31): drive Jimmy's Adventure (3334698274) in a real browser
// with the whole living-craft stack and report WHAT RUNS: the farm
// (GIANTPLANE computer + the Crafter built-in), the energy flow (62 RTGs
// vs the mosaic draw, the anchored HV drill), the item chain census
// (drill→junction→crusher→containers + the crafter installation), the
// press registry, the lamp glow law and any console error. Usage:
//   node tools/jimmyprobe.mjs [baseURL]
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
await page.goto(`${BASE}/?craft=3334698274`);
await page.waitForFunction(() => !!window.__ARCHEAN__, null, { timeout: 120_000 });
console.log('load ms', Date.now() - t0);
await page.waitForFunction(() =>
  (window.__XENON__?.()?.farm ?? []).some(f => f.cycles > 40), null, { timeout: 120_000 })
  .catch(() => console.log('NOTE: farm never reached 40 cycles (computers nested/absent?)'));

const farm = await page.evaluate(() => window.__XENON__?.()?.farm ?? []);
console.log('FARM', JSON.stringify(farm.map(f => ({ comp: f.comp, cycles: f.cycles, abi: f.abi }))));

const energyChip = await page.locator('[data-testid="energy-chip"]').textContent().catch(() => null);
console.log('ENERGY CHIP', JSON.stringify(energyChip));
if (energyChip) {
  await page.locator('[data-testid="energy-chip"]').click();
  const panel = await page.locator('[data-testid="energy-panel"]').innerText();
  console.log('ENERGY PANEL\n' + panel.replace(/\n+/g, ' | '));
}
await page.waitForTimeout(6000);   // let the drill mine (10/s, 1.5 s hops)
const itemsChip = await page.locator('[data-testid="items-chip"]').textContent().catch(() => null);
console.log('ITEMS CHIP', JSON.stringify(itemsChip));
if (itemsChip) {
  await page.locator('[data-testid="items-chip"]').click();
  console.log('ITEMS PANEL\n' + (await page.locator('[data-testid="items-panel"]').innerText())
    .replace(/\n+/g, ' | '));
}
console.log('PRESS REGISTRY', JSON.stringify(await page.evaluate(() => window.__ARCHEAN__.press())));
console.log('STATS', JSON.stringify(await page.evaluate(() => window.__ARCHEAN__.stats())));
// the drill animation census: MiningDrill #19 renders a joint? (no joint —
// the drill spins via the sim? check any actuator pose moved: the SmallPivot)
console.log('PIVOT Q', JSON.stringify(await page.evaluate(() => window.__ARCHEAN__.jointPoseQ(20, 'axle'))));
console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
await browser.close();
