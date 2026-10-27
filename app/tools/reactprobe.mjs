import { chromium } from '@playwright/test';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
// A: plain WebGL init on a bare page
for (let i = 0; i < 3; i++) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const t = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
    document.body.appendChild(c);
    const t0 = performance.now();
    const gl = c.getContext('webgl2', { antialias: true });
    const t1 = performance.now();
    gl.enable(gl.DEPTH_TEST); gl.clearColor(0.1, 0.2, 0.3, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const t2 = performance.now();
    return { ctx: Math.round(t1 - t0), draw: Math.round(t2 - t1) };
  });
  console.log('bare webgl2', JSON.stringify(t));
  await ctx.close();
}
// B: React 19 (from the app's own node_modules, esbuild-bundled inline via data URL? use CDN-free: use the app preview's vite dev? Simplest: use the app's react from node with a prebuilt bundle)
await browser.close();
