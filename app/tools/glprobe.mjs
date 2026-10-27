import { chromium } from '@playwright/test';
const URL = 'http://127.0.0.1:5188';
const variants = [
  { name: 'angle-vulkan (current)', args: ['--use-gl=angle', '--use-angle=vulkan'], env: { VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } },
  { name: 'angle-gl mesa', args: ['--use-gl=angle', '--use-angle=gl'], env: { __EGL_VENDOR_LIBRARY_FILENAMES: '/usr/share/glvnd/egl_vendor.d/50_mesa.json' } },
  { name: 'angle-default', args: [], env: {} },
];
for (const v of variants) {
  let browser;
  try {
    browser = await chromium.launch({
      env: { ...process.env, ...v.env },
      args: ['--no-sandbox', '--disable-dev-shm-usage', ...v.args],
    });
  } catch (e) { console.log(v.name.padEnd(22), 'LAUNCH FAIL', String(e).slice(0, 80)); continue; }
  const times = [], rends = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript(() => { localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
    const page = await ctx.newPage();
    const t0 = Date.now();
    await page.goto(URL + '/?craft=3812927875', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
    times.push(Date.now() - t0);
    const m = await page.evaluate(() => ({
      r: performance.getEntriesByName('boot:renderer', 'mark')[0]?.startTime ?? -1,
      a: performance.getEntriesByName('boot:attach', 'mark')[0]?.startTime ?? -1 }));
    rends.push(Math.round(m.r), 0);
    const gpu = await page.evaluate(() => {
      const c = document.createElement('canvas'); const g = c.getContext('webgl2');
      if (!g) return 'no webgl2';
      const d = g.getExtension('WEBGL_debug_renderer_info');
      return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'no ext';
    });
    await ctx.close();
    if (i === 0) console.log(v.name.padEnd(22), 'gpu:', String(gpu).slice(0, 60));
  }
  await browser.close();
  const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
  console.log(v.name.padEnd(22), 'pass', med(times) + 'ms', ' renderer-mark ~', med(rends.filter(x => x > 0)) + 'ms');
}
