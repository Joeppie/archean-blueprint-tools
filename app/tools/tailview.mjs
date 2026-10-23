// tail close-up eyeball: build the tailed balloon, then fly the camera to
// the tail and shoot. node tools/tailview.mjs [port]
import { chromium } from 'playwright';
const PORT = process.argv[2] ?? 5175;
const b = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
ctx.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${PORT}/`);
await p.getByTestId('gallery-new').click();
await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60_000 });
await p.getByTestId('tools-menu').click();
await p.getByTestId('tool-balloon').click();
const setR = async (k, v) => p.evaluate(([k2, v2]) => {
  const el = document.querySelector(`[data-testid="tool-range-${k2}"]`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v2));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, [k, v]);
await p.getByTestId('tool-opt-profile-cylinder').click();
await p.getByTestId('tool-opt-fins-on').click();
await setR('rx', 2); await setR('ry', 2); await setR('rz', 8);
await p.waitForFunction(() => document.querySelector('[data-testid="tool-preview"]')?.textContent?.includes('rudder'), null, { timeout: 40_000 });
await p.getByTestId('tool-ok').click();
await p.getByTestId('tool-confirm').click();
await p.getByTestId('place-build').click();
await p.getByTestId('tool-toast').waitFor({ timeout: 20_000 });
await p.waitForTimeout(2500);
async function drag(dx, dy) {
  await p.mouse.move(850, 470); await p.mouse.down();
  await p.mouse.move(850 + dx, 470 + dy, { steps: 18 }); await p.mouse.up();
  await p.waitForTimeout(400);
}
async function wheel(y, n = 6) {
  await p.mouse.move(850, 470);
  for (let i = 0; i < n; i++) await p.mouse.wheel(0, y);
  await p.waitForTimeout(400);
}
// deterministic fly: poke the (runtime-accessible) camera + orbit target to
// a side view of the tail (world tail end ≈ z 7.8, hull centre y ≈ 0)
await p.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  e.camera.position.set(12.5, 1.6, 6.4);
  e.controls.target.set(0, 0.2, 6.6);
  e.controls.update();
});
await p.waitForTimeout(700);
await p.screenshot({ path: '/tmp/opencode/tail-close.png' });
await p.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  e.camera.position.set(9.5, 0.8, 6.9);
  e.controls.target.set(0, 0.3, 7.2);
  e.controls.update();
});
await p.waitForTimeout(700);
await p.screenshot({ path: '/tmp/opencode/tail-close2.png' });
await b.close();
console.log('shots: /tmp/opencode/tail-close{,2}.png');
