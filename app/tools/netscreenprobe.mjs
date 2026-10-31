// netscreenprobe.mjs — THE NET-SCREEN PROBE (v1.16.11 WP-A, workpackages):
// the user's report: "http://…:5175/?craft=3828773626 doesn't show anything
// on its screens". Boot the ChipOS Dev Kit with the LIVE farm, let the
// computers auto-boot (the kit's dashboards hang off MiniRouters and the
// program addresses them with runtime VARIABLES — the net-screen law
// pre-registers them). Report: the farm lineup, the 3-D feed registry
// (keys + sizes — 300×300 = the 6 px/unit element law, NOT the shim's
// 640×480 seed), the push counters and the INK census per fed face.
// Usage: node tools/netscreenprobe.mjs [baseURL] [craftId]
import { chromium } from '@playwright/test';

const BASE = process.argv[2] ?? 'http://127.0.0.1:5175';
const CRAFT = process.argv[3] ?? '3828773626';
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
await page.goto(`${BASE}/?craft=${CRAFT}`);
await page.waitForFunction(() => !!window.__ARCHEAN__, null, { timeout: 120_000 });
console.log('load ms', Date.now() - t0);
await page.waitForFunction(() =>
  (window.__XENON__?.()?.farm ?? []).some(f => f.cycles > 60), null, { timeout: 90_000 })
  .catch(() => console.log('NOTE: farm never reached 60 cycles'));
// the 3-D law needs a pump to have setScreenFeeds: the LIVE-chip auto-boot
// drives the farm; the feeds ride the LAST-opened IDE… the live path feeds
// via the farm's per-pump cycle hooks (Editor). Poll for registry entries.
await page.waitForFunction(() =>
  (window.__ARCHEAN__.engine.screenFeedState() ?? []).length > 0, null, { timeout: 60_000 })
  .catch(() => console.log('NOTE: screenFeedState stayed EMPTY (no feeds set)'));
await page.waitForTimeout(4000);   // ink accumulates at 25 Hz
const feeds = await page.evaluate(() => window.__ARCHEAN__.engine.screenFeedState());
console.log('FEEDS', JSON.stringify(feeds));
const ink = await page.evaluate((keys) => Object.fromEntries(
  keys.map(k => [k, +window.__ARCHEAN__.engine.screenFeedInk(k).toFixed(4)])),
  feeds.map(f => f.key));
console.log('INK', JSON.stringify(ink, null, 1));
const pushes = await page.evaluate((keys) => Object.fromEntries(
  keys.map(k => [k, window.__ARCHEAN__.engine.pushCounts.get(k) ?? 0])),
  feeds.map(f => f.key));
console.log('PUSHES', JSON.stringify(pushes));
const farm = await page.evaluate(() => window.__XENON__?.()?.farm ?? []);
console.log('FARM', JSON.stringify(farm.map(f => ({ comp: f.comp, cycles: f.cycles }))));
// the chipos pump's OWN surface census: ink per surface (where is ChipOS
// drawing — the wizard on main#0, the shell on main-screen#…?)
const census = await page.evaluate((alias) => {
  const X = () => window.__XENON__();
  const out = [];
  for (const m of X().pumpSurfaces(alias)) {
    const p = X().pumpPixels(alias, m.key);
    let ink = null;
    if (p) {
      const n = p.data.length / 4;
      const stride = Math.max(1, Math.floor(n / 8000));
      let seen = 0;
      for (let i = 0; i < n; i += stride) {
        seen++;
        if (p.data[i * 4] > 8 || p.data[i * 4 + 1] > 8 || p.data[i * 4 + 2] > 8) ink = (ink ?? 0) + 1;
      }
      ink = seen ? +(((ink ?? 0)) / seen).toFixed(3) : 0;
    }
    out.push({ key: m.key, w: m.w, h: m.h, ink });
  }
  return out;
}, 'chipos');
console.log('CHIPOS SURFACES', JSON.stringify(census));
console.log('ERRORS', errors.length ? JSON.stringify(errors.slice(0, 8)) : 'none');
await browser.close();
