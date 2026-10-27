// livecheck.mjs — boots the LIVE Pages site headless and asserts the engine
// reaches a built scene (the __ARCHEAN__ hook) — the publish smoke test.
import { chromium } from '@playwright/test';
const URL = 'https://joeppie.github.io/archean-blueprint-tools/';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
const bad = [];
page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url().slice(0, 90)}`); });
const t0 = Date.now();
await page.goto(URL + '?craft=3812927875', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__ARCHEAN__?.engine?.stats, null, { timeout: 90_000 });
await page.waitForFunction(() => {
  const s = window.__ARCHEAN__?.engine?.stats?.();
  return s && (s.blocks > 0 || s.comps > 0);
}, null, { timeout: 90_000 });
const st = await page.evaluate(() => window.__ARCHEAN__.stats());
console.log(`live boot ${Date.now() - t0} ms · blocks=${st.blocks} tris=${st.tris} comps=${st.comps} ok=${st.ok} tier=${st.tier}`);
console.log(bad.length ? `HTTP >=400: ${bad.join(' | ')}` : 'zero HTTP failures');
await browser.close();
