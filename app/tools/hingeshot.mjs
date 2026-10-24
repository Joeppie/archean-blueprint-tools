// hingeshot.mjs — EYEBALL (v1.9.3): the hinge ATTITUDE tour (sibling of
// tailshot.mjs, which keeps its v1.8.5 ghost/wire/pipes A/B duty): build the
// finned balloon through the live UI, print each hinge's captured joint line,
// and screenshot the tail so the RUDDER HINGE ATTITUDE can be judged visually
// (v1.9.3 rule: the hinge LIES like the two fin hinges — tower AFT, connector
// toward the body — rolled one +90° about the ship axis; a lying line means
// the tall rudder vane's TOP swings SIDEWAYS). usage: node tools/hingeshot.mjs [port]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.argv[2] ?? 5175;
mkdirSync('reports/tail', { recursive: true });
const b = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
ctx.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
const p = await ctx.newPage();
p.on('console', m => { if (m.type() === 'error') console.log('PAGE-ERR', m.text().slice(0, 160)); });
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
await p.waitForFunction(() => document.querySelector('[data-testid="tool-preview"]')
  ?.textContent?.includes('rudder'), null, { timeout: 60_000 });
await p.getByTestId('tool-ok').click();
await p.getByTestId('tool-confirm').click();
await p.getByTestId('place-build').click();
await p.getByTestId('tool-toast').waitFor({ timeout: 30_000 });
await p.waitForFunction(() => window.__ARCHEAN__.engine.pendingReal === 0, null, { timeout: 90_000 }).catch(() => {});
await p.waitForTimeout(1500);

// the captured joint lines + the file orientations (no ghost turns here, so
// the join order rudder, aileronL, aileronR names the roles)
const info = await p.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  const d = e.blueprint.data;
  const out = [];
  (d.composite_builds ?? []).forEach((j, k) => {
    const master = d.components[j.component];
    if (!master || master.type !== 'SmallHinge') return;
    const jr = (e.subJrefs.get(j.slaveBuildId) ?? [])[0];
    out.push({
      role: ['rudder', 'aileronL', 'aileronR'][k] ?? '?',
      orientation: master.orientation,
      axis0: jr ? jr.axis0.map(v => +v.toFixed(3)) : null,
      pos: master.position,
    });
  });
  return out;
});
console.log('hinge joint lines (rudder axis0 must LIE along the ship axis [0,0,±1]):');
for (const h of info) console.log(JSON.stringify(h));

// camera tours: the tail seen behind-high, from the aft end along the axis,
// and close on the rudder hinge
const shots = [
  { name: 'tail-behind', at: [3.5, 2.8, 12.5], to: [0, 0.4, 8] },
  { name: 'tail-aftend', at: [0.001, 0.9, 11.5], to: [0, 0.4, 7.8] },
  { name: 'rudder-hinge', at: [1.5, 1.0, 9.6], to: [0, 0.5, 8] },
  { name: 'tail-side', at: [5.2, 0.6, 8.4], to: [0, 0.4, 8] },
];
for (const s of shots) {
  await p.evaluate(({ at, to }) => {
    const e = window.__ARCHEAN__.engine;
    e.controls.target.set(to[0], to[1], to[2]);
    e.controls.object.position.set(at[0], at[1], at[2]);
    e.controls.update();
  }, s);
  await p.waitForTimeout(900);
  await p.screenshot({ path: `reports/tail/${s.name}.png` });
  console.log(`shot reports/tail/${s.name}.png`);
}
await b.close();
