// hullifypair.mjs — LIVE A/B gauge for the v1.12.7 DRAW-ONLY SKIN STITCH.
// Boots the real editor on a blocky craft, runs the REAL Tools ▸ Hullify
// flow, then measures the SAME view with the stitch ON and OFF (the Engine
// session A/B seam): closed frame cost (timeRender + 1-px readPixels flush,
// the viewperf.mjs law), draw calls, stats().tris (rendered triangles) and
// the hover raycast cost. This is the frame-cost proof for "hullify kills
// the framerate"; pure geometry ratios live in stitch.test.ts.
//
// usage: node tools/hullifypair.mjs [workshop-id]   (default the airliner)
//        the dev/preview server must be up on 127.0.0.1:5175 (one-server rule)
import { chromium } from '@playwright/test';

const craft = process.argv[2] ?? '3309955432';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
});
await page.goto(`http://127.0.0.1:5175/?craft=${craft}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 180_000 });
await page.waitForTimeout(2000);

const measure = async label => {
  const m = await page.evaluate(() => {
    const e = window.__ARCHEAN__.engine;
    e.timeRender(5);                                      // warm shaders/uploads
    const ms = e.timeRender(30);
    const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
    const pts = [[0.5, 0.5], [0.42, 0.61], [0.63, 0.38], [0.3, 0.7], [0.7, 0.3]];
    const t = [];
    for (let i = 0; i < 30; i++) {
      const [fx, fy] = pts[i % pts.length];
      const t0 = performance.now();
      e.coordHoverMove(c.left + c.width * fx, c.top + c.height * fy);
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    return { ms, draws: window.__ARCHEAN__.stats().draws, hoverMed: t[Math.floor(t.length / 2)] };
  });
  console.log(`  ${label.padEnd(26)} ${m.ms.toFixed(2)} ms/frame  draws=${m.draws}  hover med ${m.hoverMed.toFixed(2)} ms`);
  return m;
};

console.log(`craft ${craft} · 1280×720 · iGPU-pinned ANGLE (Vulkan/radeon)`);
await measure('blocks (pre-hullify)');

// the REAL Tools ▸ Hullify ritual (tools.spec's flow)
await page.getByTestId('tools-menu').click();
await page.getByTestId('tool-hullify').click();
await page.waitForSelector('[data-testid="tool-dialog-hullify"]');
await page.getByTestId('tool-ok').click();
await page.getByTestId('tool-confirm').click();
await page.waitForFunction(() => document.title.includes('SCENE PASS'), null, { timeout: 30_000 });
await page.waitForTimeout(1500);

const on = await measure('hullified · stitch ON');
await page.evaluate(() => window.__ARCHEAN__.engine.setSkinStitch(false));
await page.waitForTimeout(1500);
const off = await measure('hullified · stitch OFF');
console.log(`  ratio OFF/ON: frame ${(off.ms / on.ms).toFixed(1)}×  hover ${(off.hoverMed / on.hoverMed).toFixed(1)}×`);
await browser.close();
