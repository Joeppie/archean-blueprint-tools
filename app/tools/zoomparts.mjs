// close-ups of the three tail hinge parts at rest + one deflected
import { chromium } from 'playwright';
const b = await chromium.launch({ env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' }, args: ['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=vulkan'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
ctx.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
const p = await ctx.newPage();
await p.goto('http://127.0.0.1:5175/');
await p.getByTestId('gallery-new').click();
await p.waitForFunction(() => /SCENE PASS/.test(document.title), null, { timeout: 60000 });
await p.getByTestId('tools-menu').click();
await p.getByTestId('tool-balloon').click();
const setR = async (k, v) => p.evaluate(([k2, v2]) => { const el = document.querySelector(`[data-testid="tool-range-${k2}"]`); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v2)); el.dispatchEvent(new Event('input', { bubbles: true })); }, [k, v]);
await p.getByTestId('tool-opt-fins-on').click();
await setR('rx', 2); await setR('ry', 2); await setR('rz', 8);
await p.waitForFunction(() => document.querySelector('[data-testid="tool-preview"]')?.textContent?.includes('rudder'), null, { timeout: 60000 });
await p.getByTestId('tool-ok').click();
await p.getByTestId('tool-confirm').click();
await p.getByTestId('place-build').click();
await p.getByTestId('tool-toast').waitFor({ timeout: 30000 });
await p.waitForTimeout(2500);
// hide the hull so the parts read clean
await p.keyboard.press('h');
await p.waitForTimeout(900);
const shot = async (name, px, py, pz, tx, ty, tz) => {
  await p.evaluate(({ px, py, pz, tx, ty, tz }) => {
    const e = window.__ARCHEAN__.engine;
    e.camera.position.set(px, py, pz);
    e.controls.target.set(tx, ty, tz);
    e.controls.update();
  }, { px, py, pz, tx, ty, tz });
  await p.waitForTimeout(600);
  await p.screenshot({ path: `/tmp/opencode/${name}.png` });
};
// rudder part at (0, 0.5, 8)
await shot('part-rudder', 1.1, 1.5, 9.6, 0, 0.6, 8.0);
// aileron R part at (0.375, 0, 8)
await shot('part-aileron', 2.4, 1.3, 9.9, 0.375, 0.0, 8.0);
await b.close();
console.log('ok');
