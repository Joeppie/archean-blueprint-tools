// invaders-face.mjs — the user report: open Space Invaders, boot the computer
// through the Xenon IDE, CLOSE the IDE, never open the Screens tab: is the
// 3-D Computer face fed? (from app/; usage: node /tmp/opencode/invaders-face.mjs)
import { chromium } from '@playwright/test';
const URL = process.argv[2] ?? 'http://127.0.0.1:5175';
const ctx = await chromium.launch({
  headless: true,
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 160)));
await page.addInitScript(() => {
  localStorage.setItem('archean-app-debug', '1');
  localStorage.setItem('archean-app-backdrop', 'none');
});
await page.goto(`${URL}/?craft=3288012440`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
await page.getByTestId('xenon-menu').click();
await page.getByTestId('xenon-comp-13').click();
await page.getByTestId('xenon-on').waitFor({ timeout: 60_000 });
await page.keyboard.press('Escape');                       // close the IDE, NO screens tab
await page.waitForFunction(() => ((window.__XENON__?.() ?? {}).cycles ?? 0) > 200,
  null, { timeout: 60_000 }).catch(() => console.log('TIMEOUT cycles'));

const feeds = await page.evaluate(() => window.__ARCHEAN__.engine.screenFeedKeys());
console.log('3-D feed keys:', feeds.join(', ') || '(none)');
for (const key of feeds) {
  const info = await page.evaluate(([key]) => {
    const eng = window.__ARCHEAN__.engine;
    const q = eng.screenFeedQuads().find(v => v.key === key);
    if (!q) return { key, quad: false };
    // the Computer's monitor faces the model's -Z (the nose): prefer the
    // -Z viewing side, fall back to the quad normal (farmfeedprobe law)
    const nrm = Math.abs(q.normal[2]) > 0.5 ? [0, 0, q.normal[2] > 0 ? -1 : 1] : q.normal;
    eng.auditLookAt(
      [q.center[0] + nrm[0] * 1.4, q.center[1] + nrm[1] * 1.4 + 0.35, q.center[2] + nrm[2] * 1.4],
      q.center);
    return { key, quad: true, nrm };
  }, [key]);
  if (!info.quad) { console.log(`FACE ${key}: no quad`); continue; }
  await page.waitForTimeout(600);
  const f = await page.evaluate(([key]) => {
    const eng = window.__ARCHEAN__.engine;
    const q = eng.screenFeedQuads().find(v => v.key === key);
    return q.corners.map(c => eng.projectCanvas(c[0], c[1], c[2]));
  }, [key]);
  const us = f.map(p => p.u), vs = f.map(p => p.v);
  const [u0, u1, v0, v1] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const rect = await page.evaluate(([a, b, w, h]) => {
    const r = window.__ARCHEAN__.engine.probeRect(a, b, w, h);
    return r ? { rgba: [...r.rgba] } : null;
  }, [u0, v0, u1 - u0, v1 - v0]);
  if (!rect) { console.log(`FACE ${key}: probeRect failed`); continue; }
  let lum = 0, max = 0;
  for (let i = 0; i < rect.rgba.length; i += 4) {
    const l = (rect.rgba[i] + rect.rgba[i + 1] + rect.rgba[i + 2]) / 3;
    lum += l; if (l > max) max = l;
  }
  console.log(`FACE ${key}: rendered lum=${(lum / (rect.rgba.length / 4)).toFixed(1)} max=${max.toFixed(0)}`);
}
await page.screenshot({ path: '/tmp/opencode/invaders-face.png' });
console.log('shot: /tmp/opencode/invaders-face.png');
await ctx.close();
