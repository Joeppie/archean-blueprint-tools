// plateprobe.mjs — where does the hinge PART'S OWN plate go when the angle
// turns? Measures the real-model world box of each Small* master component at
// angle 0/+35 (the part model is REBUILT in place between the reads). A plate
// must move with the panel's yaw; standing still or rolling about the
// fore-aft axis is the defect v1.9.0 THE PLATE LAW fixed.
// usage: node tools/plateprobe.mjs [port]
import { chromium } from 'playwright';
const PORT = process.argv[2] ?? 5175;
const b = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=vulkan'],
});
const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } });
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

const joins = await p.evaluate(() => {
  const d = window.__ARCHEAN__.engine.blueprint.data;
  return (d.composite_builds ?? [])
    .map(j => ({ ci: j.component, m: d.components[j.component] }))
    .filter(o => o.m && /Small/.test(o.m.type))
    .map(o => ({ ci: o.ci, type: o.m.type, pos: o.m.position, q: o.m.orientation }));
});
for (const j of joins) {
  const set = async (a) => {
    await p.evaluate(({ ci, a: a2 }) => {
      const e = window.__ARCHEAN__.engine;
      const m = e.blueprint.data.components[ci];
      m.data = { ...(m.data ?? {}), angle: a2 };
      e.liveDataEdit(ci);
      e.dataEdited();
    }, { ci: j.ci, a });
    await p.waitForTimeout(450);                            // the live rebuild frame
  };
  const box = async () => p.evaluate((ci) => {
    const e = window.__ARCHEAN__.engine;
    const real = (e.compRoots.get(ci) ?? []).find(o => o.userData?.real);
    if (!real) return null;
    e.scene.updateMatrixWorld(true);
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    real.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry, pos = g.attributes.position, m = o.matrixWorld.elements;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const q = [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
      }
    });
    return { mn: mn.map(v => +v.toFixed(3)), mx: mx.map(v => +v.toFixed(3)) };
  }, j.ci);
  await set(0); const s0 = await box();
  await set(35); const s1 = await box();
  await set(0);
  const role = Math.abs(j.pos.x) < 0.05 ? 'rudder' : 'aileron';
  console.log(`\n${role} ${j.type} ci=${j.ci}`);
  console.log(`  pos ${JSON.stringify([j.pos.x, j.pos.y, j.pos.z])} q ${JSON.stringify([j.q.w, j.q.x, j.q.y, j.q.z].map(v => +v.toFixed(3)))}`);
  console.log(`  model box @0    min ${JSON.stringify(s0?.mn)} max ${JSON.stringify(s0?.mx)}`);
  console.log(`  model box @+35  min ${JSON.stringify(s1?.mn)} max ${JSON.stringify(s1?.mx)}`);
}
await b.close();
