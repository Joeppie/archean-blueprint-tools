// ruddershoot.mjs — eyeball the arbitration: build the finned balloon, fly
// behind the tail, shoot the rudder at angle 0 / +35 / −35 (both the panel
// AND the hinge part's own plate). usage: node tools/ruddershoot.mjs [port]
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
await p.waitForFunction(() => document.querySelector('[data-testid="tool-preview"]')?.textContent?.includes('rudder'), null, { timeout: 60_000 });
await p.getByTestId('tool-ok').click();
await p.getByTestId('tool-confirm').click();
await p.getByTestId('place-build').click();
await p.getByTestId('tool-toast').waitFor({ timeout: 30_000 });
await p.waitForFunction(() => window.__ARCHEAN__.engine.pendingReal === 0, null, { timeout: 90_000 }).catch(() => {});
await p.waitForTimeout(1500);
// behind + slightly above the tail looking forward at the rudder
const view = () => p.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  e.camera.position.set(0.01, 2.2, 16.5);
  e.controls.target.set(0, 0.4, 9.0);
  e.controls.update();
});
const shoot = async (a, tag) => {
  await p.evaluate((a2) => {
    const e = window.__ARCHEAN__.engine;
    const d = e.blueprint.data;
    const join = (d.composite_builds ?? []).find(j => /Small/.test(d.components[j.component].type)
      && Math.abs(d.components[j.component].position.x) < 0.05);
    const m = d.components[join.component];
    m.data = { ...(m.data ?? {}), angle: a2 };
    e.dataEdited();
  }, a);
  await view();
  await p.waitForTimeout(700);
  await p.screenshot({ path: `/tmp/opencode/rudder-${tag}.png` });
};
await shoot(0, 'rest');
await shoot(35, 'plus35');
await shoot(-35, 'minus35');
console.log('shots: /tmp/opencode/rudder-{rest,plus35,minus35}.png');
await b.close();
