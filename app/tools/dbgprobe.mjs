// dbgprobe.mjs — triage the F9 breakpoint law on the CEP craft: opens the
// IDE, clicks the gutter of the given line, then samples __XENON__()
// (paused, pausedAt, cycles, cycleLines) to see WHY the pump does not stop.
//   node tools/dbgprobe.mjs [line]   (default 17; APP_URL=... dev default)
import { chromium } from '@playwright/test';

const LINE = Number(process.argv[2] ?? 17);
const CRAFT = '3327182790';
const BASE = process.env.APP_URL ?? 'http://127.0.0.1:5175';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({
  storageState: { cookies: [], origins: [{ origin: BASE,
    localStorage: [{ name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
await page.goto(`${BASE}/?craft=${CRAFT}`);
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
await page.getByTestId('xenon-menu').click();
await page.locator('[data-testid^="xenon-comp-"]').first().click();
await page.getByTestId('xenon-tab-0').click();
const gutter = page.locator(`[data-line="${LINE}"] span`).first();
await gutter.waitFor({ timeout: 30_000 });
console.log('gutter line text:', (await page.locator(`[data-line="${LINE}"]`).innerText()).replace(/\s+/g, ' ').slice(0, 90));
await gutter.click();
await page.getByTestId(`xenon-bp-${LINE}`).waitFor({ timeout: 10_000 });
console.log('bp dot visible');
// THE LEG'S EXACT CHECK: the PAUSED pill in the dialog header
try {
  await page.getByTestId('xenon-paused').waitFor({ timeout: 15_000 });
  console.log('PILL visible:', await page.getByTestId('xenon-paused').innerText());
} catch {
  console.log('PILL MISSING — pump state:', JSON.stringify(await page.evaluate(() => {
    const s = window.__XENON__?.() ?? {};
    return { status: s.status, cycles: s.cycles, paused: s.paused, raf: s.raf, lines: (s.cycleLines ?? []).slice(0, 10) };
  })));
}
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => window.__XENON__?.());
  console.log(`t=${(i + 1) * 2}s`, JSON.stringify({
    status: s?.status, cycles: s?.cycles, paused: s?.paused,
    cycleLines: (s?.cycleLines ?? []).slice(0, 12),
  }));
  if (s?.paused) break;
}
await browser.close();
