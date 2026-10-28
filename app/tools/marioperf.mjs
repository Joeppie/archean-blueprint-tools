// marioperf.mjs — where does Mario's time go: VM cycles/s (+ per-cycle ms)
// and the JS blit cost, at normal and CPU-throttled (≈ phone) speed.
//   node tools/marioperf.mjs [cpuThrottle]   (APP_URL=... default preview/dev)
import { chromium } from '@playwright/test';

const THROTTLE = Number(process.argv[2] ?? 1);
const CRAFT = '3820116990';
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5254';
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
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
await page.goto(`${BASE}/?craft=${CRAFT}&dash=first-virtual`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
// close the deep-linked zoom window so the TopBar is reachable
await page.getByTestId('screens-cell-virtual#0#0-fullexit').click({ timeout: 120_000 });
await page.getByTestId('screens-close').click();
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.getByTestId('xenon-side-bus').click();
// boot the game (mash jump) so the heavy render loop runs
for (let i = 0; i < 40; i++) {
  await page.keyboard.down('f');
  await page.waitForTimeout(60);
  await page.keyboard.up('f');
  await page.waitForTimeout(1040);
  const s = await page.evaluate(() => window.__XENON__?.());
  const music = (s?.bus ?? []).some(([k, v]) => /melody:1/.test(k) && Number(v) > 10);
  if (music) break;
}
if (process.env.BREAK) {
  // v1.13.31 (workpackages WP6): arm a NEVER-FIRING breakpoint so the
  // TRACKING GATE is fully open (per-line record + pair/depth JSON every
  // cycle) — the measured cps is then the debugger's true per-cycle cost.
  const files = await page.evaluate(() => window.__XCDBG__.files());
  await page.evaluate((n) => window.__XCDBG__.break(n, [999999]), files[0].name);
  console.log('armed: never-firing breakpoint (tracking gate fully open)');
}
const c0 = await page.evaluate(() => window.__XENON__?.()?.cycles ?? 0);
await page.waitForTimeout(15000);
const c1 = await page.evaluate(() => window.__XENON__?.()?.cycles ?? 0);
const cps = (c1 - c0) / 15;
// how many visible canvas blits per cycle (Virtual tab shows the surfaces)
const canv = await page.locator('[data-testid^="screens-canvas-"]').count();
console.log(`throttle=${THROTTLE}x game-cycles/s=${cps.toFixed(1)} (target 25) visible canvases=${canv}`);
console.log(cps < 20 ? '=> the VM cycle is the bottleneck (cycle time > 40 ms)'
  : '=> VM keeps 25 Hz at this throttle');
await browser.close();
