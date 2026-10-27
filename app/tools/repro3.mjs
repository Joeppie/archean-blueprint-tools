import { chromium } from '@playwright/test';
const PORT = 5188, URL = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=vulkan'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 },
  storageState: { cookies: [], origins: [{ origin: URL, localStorage: [
    { name: 'archean-app-debug', value: '1' }, { name: 'archean-app-backdrop', value: 'none' }]}]} });
const page = await ctx.newPage();
await page.goto(URL + '/?craft=9000005001');
await page.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 30000 });
await page.getByTestId('mode-edit').click();
await page.getByTestId('ws-tris').click();
const chip = page.getByTestId('mirw-x');
if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
const tris = () => page.evaluate(() => window.__ARCHEAN__.engine.blueprint.data.triangles?.length ?? 0);
const n0 = await tris();
const spots = await page.evaluate(() => {
  const c = document.querySelector('canvas'), r = c.getBoundingClientRect();
  const e = window.__ARCHEAN__.engine;
  const pts = [];
  for (let fy = 0.3; fy <= 0.85; fy += 0.02)
    for (let fx = 0.25; fx <= 0.75; fx += 0.02) {
      const h = e.pickCell(r.left + r.width * fx, r.top + r.height * fy);
      if (h && h.bi >= 0 && h.point && Math.abs(h.point[0]) <= 0.8)
        pts.push({ x: r.left + r.width * fx, y: r.top + r.height * fy });
    }
  if (pts.length < 3) return null;
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const p1 = pts[0];
  const p2 = pts.reduce((m, p) => (d(p, p1) > d(m, p1) ? p : m), p1);
  const p3 = pts.reduce((m, p) => (Math.min(d(p, p1), d(p, p2)) > Math.min(d(m, p1), d(m, p2)) ? p : m), p1);
  if (d(p1, p2) < 80 || Math.min(d(p3, p1), d(p3, p2)) < 60) return null;
  return [p1, p2, p3];
});
console.log('n0', n0, 'spots', spots && spots.length);
for (const s of spots) { await page.mouse.click(s.x, s.y); await page.waitForTimeout(120); }
for (let i = 0; i < 25 && (await tris()) < n0 + 2; i++) await page.waitForTimeout(200);
console.log('tris after', await tris());
await page.keyboard.press('Escape');
await page.getByTestId('ws-edit').click();
await page.waitForTimeout(400);
const info = await page.evaluate(() => {
  const bp = window.__ARCHEAN__.engine.blueprint;
  const tris = bp.data.triangles || [];
  const t = tris[tris.length - 2];
  if (!t) return { err: 'no tris' };
  const g = (k) => t['v0_' + k] + 12 * (t['f0_' + k] | 0);
  const c = ['x','y','z'].map(k => {
    const gv = [0,1,2].map(i => t['v'+i+'_'+k] + 12 * (t['f'+i+'_'+k] | 0));
    return (gv[0]+gv[1]+gv[2])/3 * 0.25 - 1.5;
  });
  const s = window.__ARCHEAN__.screen(c[0], c[1], c[2]);
  const pick = s ? window.__ARCHEAN__.triPick(s[0], s[1]) : null;
  const n = tris.length;
  return { n, centroid: c, screen: s ? [Math.round(s[0]), Math.round(s[1])] : null,
    pick, idxSelf: n - 2 };
});
console.log(JSON.stringify(info, null, 1));
const px = await page.evaluate(() => {
  const c = document.querySelector('canvas'), r = c.getBoundingClientRect();
  for (let step = 0.02; step >= 0.008; step -= 0.004)
    for (let fy = 0.2; fy <= 0.9; fy += step)
      for (let fx = 0.15; fx <= 0.85; fx += step) {
        const t = window.__ARCHEAN__.triPick(r.left + r.width * fx, r.top + r.height * fy);
        if (t && (t.kind === undefined || t.kind === 'tri')) return { x: Math.round(r.left + r.width * fx), y: Math.round(r.top + r.height * fy), t: t.t, kind: t.kind };
      }
  return null;
});
console.log('any tri pick:', JSON.stringify(px));
await browser.close();
