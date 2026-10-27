import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
for (const aa of [true, false]) for (const [w, h] of [[1280, 720], [980, 600], [800, 500]]) {
  const times = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    await page.goto('about:blank');
    const ms = await page.evaluate((aa) => {
      const c = document.createElement('canvas');
      document.body.appendChild(c);
      const t0 = performance.now();
      const gl = c.getContext('webgl2', { antialias: aa, alpha: false });
      const t1 = performance.now();
      // a first tiny draw (shader/context first-use cost)
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      const t2 = performance.now();
      return { create: t1 - t0, firstDraw: t2 - t1 };
    }, aa);
    times.push(ms);
    await ctx.close();
  }
  console.log(`aa=${aa} ${w}x${h}  create ${times.map(t => Math.round(t.create)).join('/')}  firstDraw ${times.map(t => Math.round(t.firstDraw)).join('/')}`);
}
await browser.close();
