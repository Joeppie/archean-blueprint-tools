// viewperf.mjs — RELATIVE PERFORMANCE GAUGE for the v1.9.2 View-menu batch
// (user: "Add some e2e tests for it to, and gauge relative performance").
//
// Measures the LIVE editor (real scene, real materials, iGPU-pinned headless
// chromium) across the scenario matrix this batch introduced:
//   perspective ⇄ orthographic   ×   backdrop none ⇄ mars ⇄ earth
// plus the DOM→three hover path (Engine.coordHoverMove = the pickCell
// raycast the pointermove handler drives — the hot path the batch THROTTLED
// to ~40 Hz; the numbers show what one raycast costs and what the cap
// buys at the ~120 Hz a modern mouse fires at).
//
// Frame cost is Engine.timeRender(n): n synchronous renders CLOSED with a
// 1-px readPixels, so the GPU queue is flushed — real frame cost, not rAF
// pacing (which saturates at 60 fps on a healthy GPU and hides every delta).
// Draw calls come from stats() (PERF.md rule: on SwiftShader the fps number
// is meaningless, the draw count is not).
//
// usage: node tools/viewperf.mjs [workshop-id]        (default ISW-241)
//        node tools/viewperf.mjs 3509975859           (the 1024-comp giant)
import { chromium } from '@playwright/test';

const craft = process.argv[2] ?? '3812927875';
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
await page.goto(`http://127.0.0.1:5175/?craft=${craft}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 120_000 });
await page.waitForTimeout(2000);                        // atlas + first frames settle

const setView = async (ortho, backdrop) => {
  await page.evaluate(({ ortho, backdrop }) => {
    const e = window.__ARCHEAN__.engine;
    e.setBackdrop(backdrop);
    e.setProjection(ortho);
  }, { ortho, backdrop });
  await page.waitForFunction(b => {
    const s = window.__ARCHEAN__.engine.backdropState();
    return s.current === b && (b === 'none' || s.ready);
  }, backdrop, { timeout: 20_000 });
  await page.waitForTimeout(400);
};
const frameMs = async () => page.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  e.timeRender(10);                                     // warm: uploads, shaders
  return { ms: e.timeRender(40), draws: window.__ARCHEAN__.stats().draws };
});

console.log(`craft ${craft} · 1280×720 · iGPU-pinned ANGLE (Vulkan/radeon)`);
for (const ortho of [false, true])
  for (const backdrop of ['none', 'mars', 'earth']) {
    await setView(ortho, backdrop);
    const { ms, draws } = await frameMs();
    console.log(`  ${(ortho ? 'ortho ' : 'persp ').padEnd(6)} backdrop=${backdrop.padEnd(5)}`
      + ` ${ms.toFixed(2)} ms/frame (${(1000 / ms).toFixed(0)} fps cap) draws=${draws}`);
  }
await setView(false, 'none');

// the pointermove hot path: coordHoverMove = pickCell (recursive scene
// raycast) + snap + mark rebuild. Before this batch it ran on EVERY
// pointermove event; the View-batch audit capped the READOUT at ~40 Hz.
const hover = await page.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  const c = document.querySelector('[data-testid="canvas"]').getBoundingClientRect();
  const pts = [[0.5, 0.5], [0.42, 0.61], [0.63, 0.38], [0.3, 0.7], [0.7, 0.3]];
  const t = [];
  for (let i = 0; i < 40; i++) {
    const [fx, fy] = pts[i % pts.length];
    const t0 = performance.now();
    e.coordHoverMove(c.left + c.width * fx, c.top + c.height * fy);
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  return { med: t[Math.floor(t.length / 2)], p95: t[Math.floor(t.length * 0.95)] };
});
console.log(`  hover readout raycast: median ${hover.med.toFixed(2)} ms, p95 ${hover.p95.toFixed(2)} ms`);
console.log(`    uncapped @120 Hz mouse: ${(hover.med * 120 / 10).toFixed(0)}% of one core`
  + ` → capped @40 Hz: ${(hover.med * 40 / 10).toFixed(0)}%`);
await browser.close();
