// farmfeedprobe.mjs — reproduce "Space Invaders shows no main graphic on
// load" (v1.15.x regression, we 2026-10-29). Loads a craft via the PLAYABLE
// DEEP LINK ONLY (dock opens, NO Xenon IDE window — the gallery-card path),
// then measures, per physical screen feed:
//   • the farm/surface state via __XENON__
//   • mean luminance of the RENDERED 3-D face (probeRect of the feed quad)
//     — a BLACK face (lum ~ background) = the surface never reached the scene
//   • lit pixels of the dock zoom canvas (the dock path, pump blits)
// Usage: node tools/farmfeedprobe.mjs [base-url] [craft] [dash]   (from app/)
import { chromium } from '@playwright/test';

const URL = process.argv[2] ?? 'http://127.0.0.1:5175';
const CRAFT = process.argv[3] ?? '3288012440';
const DASH = process.argv[4] ?? 'main%230';

const ctx = await chromium.launch({
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
});
const X = () => page.evaluate(() => (window.__XENON__ ? window.__XENON__() : null));

await page.goto(`${URL}/?craft=${CRAFT}&dash=${DASH}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
// let the dock's pump boot + cycle (NO Xenon IDE click — the deep-link path)
await page.waitForFunction(() => ((window.__XENON__?.() ?? {}).cycles ?? 0) > 200,
  null, { timeout: 60_000 }).catch(() => console.log('TIMEOUT: cycles never reached 200'));

const x = await X();
console.log('status:', x.status, '| cycles:', x.cycles);
console.log('farm:', JSON.stringify(x.farm));
console.log('surfaces:', x.surfaceMeta.map(m => `${m.key} ${m.w}x${m.h}`).join(' | '));
const feeds = await page.evaluate(() => window.__ARCHEAN__.engine.screenFeedKeys());
console.log('3-D feed keys:', feeds.join(', ') || '(none)');

// mean luminance of each physical feed quad AS RENDERED in the 3-D view
for (const key of feeds) {
  const info = await page.evaluate(([key]) => {
    const eng = window.__ARCHEAN__.engine;
    const q = eng.screenFeedQuads().find(v => v.key === key);
    if (!q) return { key, quad: false };
    eng.auditLookAt(
      [q.center[0] + q.normal[0] * 1.4, q.center[1] + q.normal[1] * 1.4 + 0.35, q.center[2] + q.normal[2] * 1.4],
      q.center);
    return { key, quad: true };
  }, [key]);
  if (!info.quad) { console.log(`FACE ${key}: no quad`); continue; }
  await page.waitForTimeout(500);
  const f = await page.evaluate(([key]) => {
    const eng = window.__ARCHEAN__.engine;
    const q = eng.screenFeedQuads().find(v => v.key === key);
    return q.corners.map(c => eng.projectCanvas(c[0], c[1], c[2]));
  }, [key]);
  const us = f.map(p => p.u), vs = f.map(p => p.v);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const rect = await page.evaluate(([a, b, w, h]) => {
    const r = window.__ARCHEAN__.engine.probeRect(a, b, w, h);
    return r ? { w: r.w, h: r.h, rgba: [...r.rgba] } : null;
  }, [u0, v0, u1 - u0, v1 - v0]);
  if (!rect) { console.log(`FACE ${key}: probeRect failed`); continue; }
  let lum = 0, max = 0;
  for (let i = 0; i < rect.rgba.length; i += 4) {
    const l = (rect.rgba[i] + rect.rgba[i + 1] + rect.rgba[i + 2]) / 3;
    lum += l; if (l > max) max = l;
  }
  lum /= rect.rgba.length / 4;
  // the live framebuffer the pump holds for the same key (if any)
  const surf = await page.evaluate(k => {
    const p = window.__XENON__().pixels(k);
    if (!p) return null;
    let s = 0;
    for (let i = 0; i < p.data.length; i += 4) s += (p.data[i] + p.data[i + 1] + p.data[i + 2]) / 3;
    return +(s / (p.data.length / 4)).toFixed(1);
  }, key.split('#')[0] + '#0' === key ? key : key);
  console.log(`FACE ${key}: rendered lum=${lum.toFixed(1)} max=${max.toFixed(0)} | pump surface lum=${surf}`);
}

// the dock zoom canvas (pump blit path)
const zoomSel = `[data-testid="screens-cell-${decodeURIComponent(DASH)}-fullcanvas"]`;
const lit = await page.evaluate(sel => {
  const cv = document.querySelector(sel);
  if (!cv) return 'no zoom canvas';
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4)
    if ((d[i] + d[i + 1] + d[i + 2]) / 3 > 30) n++;
  return n;
}, zoomSel);
console.log('dock zoom canvas lit pixels:', lit);

await page.screenshot({ path: `/tmp/opencode/farmfeed-${CRAFT}.png` });
console.log('shot: /tmp/opencode/farmfeed-' + CRAFT + '.png');
await ctx.close();
