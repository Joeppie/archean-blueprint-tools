// envelopeprobe.mjs — sample the BUZZER MIX output (analyser RMS) fast and
// count envelope GAPS: zero-level windows surrounded by loud ones = the voice
// fully decayed and re-attacked = audible clicks/stutter (clicky-audio hunt).
//   node tools/envelopeprobe.mjs <base-url> <craft> <dash> [seconds]
import { chromium } from '@playwright/test';
const BASE = process.argv[2] ?? 'http://100.117.137.1:5175';
const CRAFT = process.argv[3] ?? '3820116990';
const DASH = process.argv[4] ?? 'first-virtual';
const SECS = Number(process.argv[5] ?? 18);

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
// gesture to arm audio + start gameplay
await page.mouse.click(640, 400);
await page.waitForTimeout(400);

const series = [];
const t0 = Date.now();
while (Date.now() - t0 < SECS * 1000) {
  await page.keyboard.down('f');
  await page.waitForTimeout(40);
  const s = await page.evaluate(() => {
    const x = window.__XENON__?.();
    return x ? { lvl: x.buzzer.outputLevel, voices: x.buzzer.voices, cycles: x.cycles } : null;
  });
  await page.keyboard.up('f');
  if (s) series.push({ t: Date.now() - t0, ...s });
  await page.waitForTimeout(20);
}
const TH = 0.003;
let loud = false, gaps = 0, gapLens = [], runs = 0, seg = 0;
for (const s of series) {
  if (s.lvl > TH) { if (!loud && runs > 1) { gaps++; gapLens.push(seg); } loud = true; runs = 0; }
  else { if (loud) { runs++; seg = runs; if (runs > 1) loud = false; } }
}
const active = series.filter(s => s.lvl > TH);
console.log(`samples=${series.length} loud=${active.length} voices=${series[series.length - 1]?.voices}`);
console.log(`mean loud RMS=${(active.reduce((a, s) => a + s.lvl, 0) / Math.max(1, active.length)).toFixed(4)}`);
console.log(`envelope GAPS (voice decayed + re-attacked mid-play): ${gaps}`);
console.log(`gap lengths (samples ~50ms): ${JSON.stringify(gapLens.slice(0, 20))}`);
// loudest moment + its neighbourhood, for pop detection
const peak = series.reduce((m, s) => (s.lvl > m.lvl ? s : m), series[0]);
console.log(`peak RMS=${peak.lvl.toFixed(4)} at t=${peak.t}ms; neighbours:`,
  series.filter(s => Math.abs(s.t - peak.t) < 120).map(s => s.lvl.toFixed(3)).join(' '));
await browser.close();
