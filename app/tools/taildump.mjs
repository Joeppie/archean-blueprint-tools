// dump the WRITTEN tail batch: cable segments + component poses (stage math check)
import { chromium } from 'playwright';
const PORT = process.argv[2] ?? 5175;
const b = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const ctx = await b.newContext({ viewport: { width: 900, height: 600 } });
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
const DIRS = ['+x', '+y', '+z', '-x', '-y', '-z'];
const dump = await p.evaluate((DIRS2) => {
  const d = window.__ARCHEAN__.engine.blueprint.data;
  const comps = d.components.map((c, i) => `${i} ${c.type} @ (${c.position.x},${c.position.y},${c.position.z}) q(${c.orientation.w},${c.orientation.x},${c.orientation.y},${c.orientation.z})`);
  const pipes = d.pipes.map(pp => ({
    a: `${d.components[pp.a_component].type}/${pp.a_port}`,
    b: `${d.components[pp.b_component].type}/${pp.b_port}`,
    segs: pp.segments.map(s => `(${s.start.x},${s.start.y},${s.start.z})${DIRS2[s.dir]}·${s.length}`),
  }));
  return { comps, pipes };
}, DIRS);
console.log(dump.comps.join('\n'));
for (const pp of dump.pipes) console.log('\n' + pp.a + ' -> ' + pp.b + '\n  ' + pp.segs.join('\n  '));
await b.close();
