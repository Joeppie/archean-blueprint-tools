// badgerprobe.mjs — triage: does the Badger firmware boot on the CURRENT
// wasm/ABI (xc_set_cycle_ms, dt 0.04, system_frequency 25)? Prints the
// pump status/cycles/error + the console-tab log at 15/30/60 s.
//   node tools/badgerprobe.mjs [craftId]
// Dev-server binding rule: uses http://127.0.0.1:5175 (or APP_URL=...).
import { chromium } from '@playwright/test';

const CRAFT = process.argv[2] ?? '3326372833';
const APP = `${process.env.APP_URL ?? 'http://127.0.0.1:5175'}/?craft=${CRAFT}`;

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
// SCENE PASS title is the DEBUG hook — arm it (the e2e storageState law)
const ctx = await browser.newContext({
  storageState: { cookies: [], origins: [{ origin: new URL(process.env.APP_URL ?? 'http://127.0.0.1:5175').origin,
    localStorage: [{ name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
page.on('console', m => {
  const t = m.text();
  if (/xenon|wasm|abi|crash|out of memory|memory/i.test(t)) console.log('PAGE:', t.slice(0, 240));
});
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 240)));
await page.goto(APP);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
console.log('scene booted');
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.getByTestId('xenon-side-console').click();   // the log pane renders only open

let t = 0;
for (const at of [10, 20, 30, 30, 30, 30]) {
  await page.waitForTimeout(at * 1000);
  t += at;
  const s = await page.evaluate(() => window.__XENON__?.() ?? null);
  console.log(`t=${t}s`, JSON.stringify({
    status: s?.status, cycles: s?.cycles, surfaces: s?.surfaces,
    error: s?.error ? String(s.error).slice(0, 260) : '',
    raf: s?.raf,
  }));
  const log = await page.getByTestId('xenon-log').innerText().catch(() => '(no log pane)');
  console.log('  log:', log.slice(0, 220).replace(/\n/g, ' | '));
  if (/ready/.test(log)) break;
}
await browser.close();
