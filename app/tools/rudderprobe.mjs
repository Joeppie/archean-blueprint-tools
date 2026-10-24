// rudderprobe.mjs — ARBITRATION (v1.9.0): build the finned balloon
// through the live UI, turn each panel master's data.angle and print HOW the
// panel actually moves in world space: the group's rotation AXIS (from the
// live quaternion), whether a point ON the captured joint line stays fixed,
// and which bbox extents grow. A rudder must YAW (axis = world up, lateral
// extent shifts, vertical extent constant); a prop-like ROLL (axis = fore-aft)
// is the bug. usage: node tools/rudderprobe.mjs [port] [deg]
import { chromium } from 'playwright';
const PORT = process.argv[2] ?? 5175;
const DEG = Number(process.argv[3] ?? 25);
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
await p.waitForFunction(() => document.querySelector('[data-testid="tool-preview"]')?.textContent?.includes('rudder'), null, { timeout: 60_000 });
await p.getByTestId('tool-ok').click();
await p.getByTestId('tool-confirm').click();
await p.getByTestId('place-build').click();
await p.getByTestId('tool-toast').waitFor({ timeout: 30_000 });
await p.waitForFunction(() => window.__ARCHEAN__.engine.pendingReal === 0, null, { timeout: 90_000 }).catch(() => {});
await p.waitForTimeout(1500);

const out = await p.evaluate(({ DEG }) => {
  const e = window.__ARCHEAN__.engine;
  const d = e.blueprint.data;
  const mo = [e.moffView.x, e.moffView.y, e.moffView.z];
  // role of each pivot: the composite_builds join pairs master ci ⇄ Build;
  // the Build's role lives in the tool order — recover it from the pivot's
  // file position (rudder = on the centreline x≈0, ailerons = lateral)
  const joins = d.composite_builds ?? [];
  const res = [];
  for (const j of joins) {
    const master = d.components[j.component];
    if (!master || !/Small/.test(master.type)) continue;
    // the Build index in the TOP-LEVEL array: slaveBuildId is FLATTENED;
    // for our batch no component nests parts, so flat index == top index
    const bi = j.slaveBuildId;
    const grp = e.subGroups.get(bi);
    const jr = (e.subJrefs.get(bi) ?? []).find(r => r.top === j.component);
    if (!grp || !jr) { res.push({ ci: j.component, type: master.type, err: 'no group/jref' }); continue; }
    const box = () => {
      e.scene.updateMatrixWorld(true);
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      grp.traverse(o => {
        if (!o.isMesh || !o.visible) return;
        const gg = o.geometry; if (!gg.boundingBox) gg.computeBoundingBox();
        const B = gg.boundingBox, m = o.matrixWorld.elements;
        for (let i = 0; i < 8; i++) {
          const v = [(i & 1 ? B.max : B.min).x, (i & 2 ? B.max : B.min).y, (i & 4 ? B.max : B.min).z];
          const q = [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], q[k]); mx[k] = Math.max(mx[k], q[k]); }
        }
      });
      return { mn, mx, span: mn.map((v, i) => mx[i] - v), c: mn.map((v, i) => (v + mx[i]) / 2) };
    };
    const onLine = () => { const m = grp.matrixWorld.elements, v = jr.pivot0.map((x, i) => x + mo[i]); return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]; };
    const snap = () => ({ box: box(), q: [grp.quaternion.w, grp.quaternion.x, grp.quaternion.y, grp.quaternion.z], onLine: onLine() });
    const setAngle = (a) => { master.data = { ...(master.data ?? {}), angle: a }; e.dataEdited(); };
    setAngle(0);
    const s0 = snap();
    setAngle(DEG);
    const s1 = snap();
    setAngle(0);
    // group rotation axis for the +DEG pose (world-frame spin of the panel)
    const [, x, y, z] = s1.q; const w = s1.q[0];
    const n = Math.hypot(x, y, z) || 1;
    const axis = [x / n, y / n, z / n].map(v => +v.toFixed(3));
    const dist = (A, B) => Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
    res.push({
      ci: j.component, bi, type: master.type,
      pos: master.position,
      role: Math.abs(master.position.x) < 0.05 ? 'rudder' : 'aileron',
      capturedAxis0: jr.axis0.map(v => +v.toFixed(3)),
      capturedPivot0: jr.pivot0.map(v => +v.toFixed(3)),
      groupQuatAxis: axis,
      groupQuatRaw: s1.q.map(v => +v.toFixed(4)),
      linePointMoved: +dist(s0.onLine, s1.onLine).toFixed(3),
      span: s0.box.span.map(v => +v.toFixed(2)),
      spanMoved: s1.box.span.map(v => +v.toFixed(2)),
      centreTravel: +dist(s0.box.c, s1.box.c).toFixed(3),
      centreDelta: s1.box.c.map((v, i) => +(v - s0.box.c[i]).toFixed(3)),
    });
  }
  return res;
}, { DEG });
console.log(`turning each panel master +${DEG}° (rx 2 / ry 2 / rz 8, no ghost turns):`);
for (const r of out) {
  console.log(`\n${r.role} (${r.type}, ci ${r.ci}, Build ${r.bi ?? '-'}) ${r.err ?? ''}`);
  if (r.err) continue;
  console.log(`  captured axis0     ${JSON.stringify(r.capturedAxis0)}`);
  console.log(`  group quat axis    ${JSON.stringify(r.groupQuatAxis)}   raw ${JSON.stringify(r.groupQuatRaw)}`);
  console.log(`  line point moved   ${r.linePointMoved} m (≈0 ⇒ turns ON its pin)`);
  console.log(`  bbox span          ${JSON.stringify(r.span)} → ${JSON.stringify(r.spanMoved)}`);
  console.log(`  centre travel      ${r.centreTravel} m, delta ${JSON.stringify(r.centreDelta)}`);
}
await b.close();
