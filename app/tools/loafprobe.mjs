import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
  window.__LOAF = [];
  new PerformanceObserver(l => { window.__LOAF.push(...l.getEntries()); })
    .observe({ type: 'long-animation-frame', buffered: true });
});
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:5188/?craft=9000005001', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
await page.waitForTimeout(500);
const loaf = await page.evaluate(() => window.__LOAF.map(f => ({
  start: Math.round(f.startTime), dur: Math.round(f.duration),
  render: Math.round(f.renderStart ? f.duration - (f.renderStart - f.startTime) : -1),
  styleLayout: Math.round(f.styleAndLayoutStart ? f.startTime + f.duration - f.styleAndLayoutStart : -1),
  scripts: f.scripts.slice(0, 3).map(s => `${s.name ?? s.invoker}:${Math.round(s.duration)}ms@${s.sourceURL?.split('/').pop() ?? '?'}:${s.sourceFunctionName ?? '?'}:${s.invokerStart?.startTime | 0}`),
})));
for (const f of loaf) console.log(JSON.stringify(f));
await browser.close();
