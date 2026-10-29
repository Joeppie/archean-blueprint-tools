// jitterprobe.mjs — measure the 25 Hz pump's CADENCE under a real game load
// (the clicky-audio hunt, 2026-10-29): samples __XENON__().cycles fast and
// reports effective Hz + the worst sample-to-sample gap. A pump timer that
// starves delays the WRITE-TIME beep scheduling (v1.13.14) past the 140 ms
// release envelope → the voice fully decays between notes = clicks.
//   node tools/jitterprobe.mjs <base-url> <craft> <dash> [seconds]
import { chromium } from '@playwright/test';
const BASE = process.argv[2] ?? 'http://100.117.137.1:5175';
const CRAFT = process.argv[3] ?? '3820116990';
const DASH = process.argv[4] ?? 'first-virtual';
const SECS = Number(process.argv[5] ?? 20);

const browser = await chromium.launch({
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--use-gl=angle', '--use-angle=vulkan', '--no-sandbox', '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({
  storageState: { cookies: [], origins: [{ origin: BASE,
    localStorage: [{ name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }] }] },
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.goto(`${BASE}/?craft=${CRAFT}&dash=${DASH}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
await page.waitForFunction(() => ((window.__XENON__?.() ?? {}).cycles ?? 0) > 60,
  null, { timeout: 120_000 });
const mode = await page.evaluate(() => window.__XENON__().farm?.length ?? -1);
console.log(`farm pumps: ${mode} | craft ${CRAFT}`);

// sample cycles every 40 ms; also press the pilot keys (gameplay load: the
// title demo is silent, input is swallowed pre-assetsready)
const t0 = Date.now();
let prevC = -1, prevT = t0;
const gaps = [];
while (Date.now() - t0 < SECS * 1000) {
  await page.keyboard.down('f');
  await page.waitForTimeout(45);
  await page.keyboard.up('f');
  const c = await page.evaluate(() => (window.__XENON__?.() ?? { cycles: -1 }).cycles);
  const t = Date.now();
  if (prevC >= 0 && c >= 0) gaps.push({ dt: t - prevT, dc: c - prevC });
  prevC = c; prevT = t;
  await page.waitForTimeout(45);
}
const totC = gaps.reduce((s, g) => s + g.dc, 0);
const totT = gaps.reduce((s, g) => s + g.dt, 0);
const hz = (totC / totT) * 1000;
// per-sample cycle-rate: dc/dt → effective Hz during that window
const rates = gaps.map(g => (g.dc / g.dt) * 1000).sort((a, b) => a - b);
const p05 = rates[Math.floor(rates.length * 0.05)];
const med = rates[Math.floor(rates.length * 0.5)];
console.log(`effective pump rate: ${hz.toFixed(1)} Hz (target 25)`);
console.log(`per-window Hz: min=${rates[0].toFixed(1)} p05=${p05.toFixed(1)} median=${med.toFixed(1)}`);
const starved = gaps.filter(g => (g.dc / g.dt) * 1000 < 15).length;
console.log(`starved windows (<15 Hz): ${starved}/${gaps.length}`);
for (const g of gaps.filter(x => (x.dc / x.dt) * 1000 < 15).slice(0, 8))
  console.log(`  gap: ${g.dt} ms → only ${g.dc} cycles (${((g.dc / g.dt) * 1000).toFixed(1)} Hz)`);
await browser.close();
