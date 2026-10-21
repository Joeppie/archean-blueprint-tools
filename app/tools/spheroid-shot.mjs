// spheroid-shot.mjs — dev-aid roundness screenshot: loads the spheroid
// fixture, parks the camera HEAD-ON (world +z toward the origin, straight
// side view = the sphere silhouette is a true circle in screen space) and
// screenshots. With --only <i> run tools/makespheroid.mjs --only <i> FIRST.
//   node tools/spheroid-shot.mjs <out.png>
import { chromium } from '@playwright/test';
const out = process.argv[2] ?? '/tmp/opencode/spheroid-shot.png';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1000, height: 760 } });
await p.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
await p.goto('http://127.0.0.1:5175/?craft=9000007001&debug', { waitUntil: 'load' });
await p.waitForFunction(() => document.title.includes('SCENE PASS'), null, { timeout: 30000 });
await p.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  e.camera.position.set(7, 4.5, 9);
  e.camera.lookAt(0, 0.9, -1);
  e.controls.target.set(0, 0.9, -1);
  e.controls.update();
  e.invalidate?.();
  const gg = e.groundGroup; if (gg) gg.visible = false;
});
await p.waitForTimeout(1500);
await p.screenshot({ path: out });
console.log('title:', await p.title());
await b.close();
