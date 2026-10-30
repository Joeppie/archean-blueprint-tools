// dolphinprobe.mjs — the DOLPHIN (3417786605): face its door toggle, hover
// (chip: broadcast law), press (a hinge in the craft swings).
const BASE = process.argv[2] ?? 'http://127.0.0.1:5175';
const { chromium } = await import('@playwright/test');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=vulkan'],
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' } });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('pageerror', e => console.log('PAGE-EXC', String(e).slice(0, 200)));
await page.addInitScript(() => { localStorage.setItem('archean-app-live', 'on');
  localStorage.setItem('archean-app-debug', '1'); localStorage.setItem('archean-app-backdrop', 'none'); });
await page.goto(`${BASE}/?craft=3417786605`);
await page.waitForFunction(() => !!window.__ARCHEAN__ && !!window.__XENON__, null, { timeout: 60000 });
await page.waitForTimeout(4000);
const out = await page.evaluate(() => {
  const A = window.__ARCHEAN__; const e = A.engine;
  const btns = [];
  e.scene.traverse(o => { if (o.userData?.pressComp) btns.push(o.userData.pressComp); });
  return { pressComps: btns.length, subs: e.subStats ? e.subStats() : null };
});
console.log('pressable parts on the dolphin:', JSON.stringify(out));
const TARGET = Number(process.argv[3] ?? 8);
const aim = await page.evaluate((TARGET) => {
  const A = window.__ARCHEAN__; const e = A.engine; const m = e.moffView;
  const b = e.compRealBox(TARGET); if (!b) return null;
  const c = [(b.min[0]+b.max[0])/2, (b.min[1]+b.max[1])/2, (b.min[2]+b.max[2])/2];
  const d = 2.6 / Math.hypot(0.9, 0.7, 1.2);
  e.auditLookAt([c[0]+m.x+0.9*d, c[1]+m.y+0.7*d, c[2]+m.z+1.2*d], [c[0]+m.x, c[1]+m.y, c[2]+m.z]);
  return [c[0]-m.x, c[1]-m.y, c[2]-m.z, (b.min[0]+b.max[0])/2, (b.min[1]+b.max[1])/2, (b.min[2]+b.max[2])/2];
}, TARGET);
console.log('target', TARGET, 'centre', JSON.stringify(aim));
await page.waitForTimeout(1300);
const px = await page.evaluate(([x,y,z]) => window.__ARCHEAN__.screen(x,y,z), aim);
const cv = await page.evaluate(() => { const r = document.querySelector('[data-testid="canvas"]').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
let hit = null;
outer:
for (const dy of [0, 10, -10, 20, -20, 30, -30]) for (const dx of [0, 10, -10, 20, -20, 30, -30]) {
  const x = px[0]+dx, y = px[1]+dy;
  if (x < cv[0]+2 || x > cv[2]-2 || y < cv[1]+2 || y > cv[3]-2) continue;
  hit = await page.evaluate(([a,b]) => window.__ARCHEAN__.pressPick(a,b), [x, y]);
  if (hit?.ci === TARGET) { hit = { ...hit, x, y }; break outer; }
  if (dy === 0 && dx === 0) console.log('centre pressPick:', JSON.stringify(hit));
}
console.log('toggle pressPick:', JSON.stringify(hit));
if (hit?.ci === TARGET) {
  await page.mouse.move(hit.x, hit.y);
  await page.waitForTimeout(350);
  console.log('chip:', JSON.stringify(await page.evaluate(() => document.querySelector('[data-testid="press-chip"]')?.textContent ?? null)));
  const q0 = await page.evaluate(() => JSON.stringify(window.__ARCHEAN__.jointPoseQ(29, 'axle')));
  await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(2500);
  const q1 = await page.evaluate(() => JSON.stringify(window.__ARCHEAN__.jointPoseQ(29, 'axle')));
  console.log('hinge29 axle q', q0, '->', q1, 'moved:', q0 !== q1);
}
await browser.close();
