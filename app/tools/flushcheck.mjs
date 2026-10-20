// flushcheck.mjs — per-component FLUSHNESS audit against the hull it rides.
//
// Arbitrates the component PLACEMENT LAW (raw file quat vs the retired
// conjugate) on REAL craft WITHOUT eyeballing: for every component of the
// chosen types it reads the live scene graph (world quaternion of the
// component root group) and asks — is the part's primary axis aligned with a
// nearby block face (deck +Y, or a slant/pyramid face normal), and does its
// origin sit ON that surface? The game-built pyramid craft (IAS-418,
// testdata/9000005001) is the fixture that flipped the law: its dashboards
// seat flush on the slant faces ONLY under R(q) raw (the 2026-10-21
// re-arbitration, FORMAT §Handedness); under the conjugate read they skew
// through the deck exactly like the user's screenshot showed.
//
// The board normal for Dashboard is its GENERATED plane's +z (FORMAT
// §Dashboard: board = box origin→(size_x/100,size_y/100,0.01), plane X·Y
// normal +z). For any other type the audit reports the world axes + origin
// and the nearest surfaces so a human reads the numbers.
//
// usage:  (dev server on :5175)  cd app && node tools/flushcheck.mjs <craft-id>
//             [--types=Dashboard] [--url http://HOST:PORT]
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const craft = args.find(a => !a.startsWith('--'));
const get = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? d;
const types = get('types', 'Dashboard').split(',');
const url = get('url', 'http://127.0.0.1:5175');
if (!craft) { console.error('usage: flushcheck.mjs <craft-id> [--types=..]'); process.exit(1); }

const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
await page.goto(`${url}/?craft=${craft}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__ARCHEAN__?.stats?.()?.comps >= 0, null, { timeout: 30000 });
await page.waitForTimeout(2500);   // real models + generated dashboards in

const report = await page.evaluate(async (types) => {
  const E = window.__ARCHEAN__.engine;
  const bp = E.bp;
  // THE SHIPPED shape table (vite serves the TS module): exact block planes,
  // never a hand-rough guess at the slants.
  const BS = await import('/src/engine/blockshapes.ts');
  // ---- block surfaces in world space (world = (pos−5.5)·0.25) ----
  const CELL = 0.25;
  const faces = [];   // {n:[3], c, block:i, kind}   plane: n·p = c
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const blocks = bp.data.blocks.filter(b => b.type !== 255);
  blocks.forEach((b, i) => {
    const lo = ['x', 'y', 'z'].map(a => (b[`pos_${a}`] - 5.5) * CELL + (b[`frame_${a}`] ?? 0) * 3);
    const sz = ['x', 'y', 'z'].map(a => (b[`size_${a}`] + 1) * CELL);
    const pts = BS.getBlockPoints(b.type, lo, sz);
    const faceIdx = BS.getBlockFaces(b.type);
    const dirs = BS.getBlockFaceDirections(b.type);
    faceIdx.forEach((idx, fi) => {
      const uniq = [...new Set(idx)];
      if (uniq.length < 3) return;
      const [a, p2, p3] = uniq.map(k => pts[k]);
      const u = [p2[0] - a[0], p2[1] - a[1], p2[2] - a[2]];
      const v = [p3[0] - a[0], p3[1] - a[1], p3[2] - a[2]];
      let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const L = Math.hypot(...n); if (L < 1e-9) return;
      n = n.map(t => t / L);
      faces.push({ n, c: dot(n, a), block: i, kind: dirs[fi] ? 'axis' : 'slant' });
    });
  });
  const distToPlane = (f, p) => Math.abs(dot(f.n, p) - f.c);

  // ---- components: world quaternion + origin from the live scene graph ----
  const out = [];
  bp.data.components.forEach((c, ci) => {
    if (!types.includes(c.type)) return;
    let q = null, p = null;
    for (const root of E.compRoots?.get(ci) ?? []) {
      const world = root.getWorldQuaternion ? root.getWorldQuaternion(new (root.quaternion.constructor)()) : root.quaternion;
      const wp = root.getWorldPosition ? root.getWorldPosition(new (root.position.constructor)()) : root.position;
      if (Math.hypot(wp.x, wp.y, wp.z) <= 50) { q = { w: world.w, x: world.x, y: world.y, z: world.z }; p = [wp.x, wp.y, wp.z]; break; }
    }
    if (!q) { out.push({ ci, type: c.type, err: 'no scene root' }); return; }
    // board normal = local +z rotated by the WORLD quaternion (three.js Quaternion.applyToVector semantics via matrix)
    const { x, y, z, w } = q;
    const R = [[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
               [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
               [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]];
    const n = R.map(r => dot(r, [0, 0, 1]));
    // FLUSH = normal-aligned AND nearest among the aligned faces (a part
    // against a pyramid side shares its normal with the distant deck side)
    let best = null;
    for (const f of faces) {
      const d = distToPlane(f, p);
      const al = Math.abs(dot(n, f.n));
      const key = al > 0.97 ? 1 : 0;
      const kbest = best ? (best.aligned > key ? false : best.aligned < key ? true
        : best.d > d) : true;
      if (kbest) best = { d, al, aligned: key, kind: f.kind, block: f.block };
    }
    // nearest-plane-with-alignment readout: align-first, distance reported
    out.push({ ci, type: c.type, n: n.map(v => +v.toFixed(3)), p: p.map(v => +v.toFixed(3)),
      align: +(best?.al ?? 0).toFixed(3), planeDist: +(best?.d ?? 99).toFixed(3), face: best?.kind, block: best?.block });
  });
  return { comps: out, faces: faces.length };
}, types);

await page.screenshot({ path: `/tmp/opencode/flushcheck-${craft}.png` });
await browser.close();

console.log(`craft ${craft}: ${report.faces} block faces, ${report.comps.length} ${types.join('/')} components`);
let bad = 0;
for (const r of report.comps) {
  if (r.err) { console.log(` comp ${r.ci} ${r.type}: ${r.err}`); bad++; continue; }
  const ok = r.align > 0.97 && r.planeDist < 0.25;
  if (!ok) bad++;
  console.log(` comp ${r.ci} ${r.type} n=(${r.n}) align ${r.align} dist ${r.planeDist} ${ok ? 'FLUSH' : '*** SKEW'}  (block ${r.block} ${r.face})`);
}
if (errs.length) console.log('page errors:', errs.slice(0, 3));
console.log(bad === 0 ? 'FLUSHCHECK PASS' : `FLUSHCHECK FAIL (${bad} skew)`);
process.exit(bad === 0 && errs.length === 0 ? 0 : 1);
