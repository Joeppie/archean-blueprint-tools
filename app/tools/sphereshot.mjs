// sphereshot.mjs — dev aid for the SPHERE SKIN tool: drives the REAL editor
// (new craft → TOOLS ▸ Sphere skin → Confirm & place → ✔ Build through the
// live UI), parks the camera, screenshots, AND measures the rendered
// SILHOUETTE: object-vs-background mask area vs the mask's convex hull area
// from the actual screenshot pixels. fill = mask/hull; 1.000 = the picture
// itself has no concavity (a dent = a bite out of the silhouette). This is
// the eyeball check the Spheroid attempts failed, automated.
//   node tools/sphereshot.mjs <rx> <ry> <rz> <out-prefix> [port]
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
const [rx, ry, rz, out, port = '5175'] = process.argv.slice(2);
if (!rx || !out) { console.error('usage: sphereshot.mjs <rx> <ry> <rz> <out-prefix> [port]'); process.exit(2); }
const BASE = `http://127.0.0.1:${port}`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1100, height: 800 } });
await p.addInitScript(() => localStorage.setItem('archean-app-debug', '1'));
await p.goto(`${BASE}/`, { waitUntil: 'load' });
await p.getByTestId('gallery-new').click();
await p.waitForFunction(() => document.title.includes('SCENE PASS'), null, { timeout: 30000 });

// stage through the UI exactly like the e2e spec
await p.getByTestId('tools-menu').click();
await p.getByTestId('tool-sphere-skin').click();
for (const [k, v] of [['rx', +rx], ['ry', +ry], ['rz', +rz]])
  await p.locator(`[data-testid="tool-range-${k}"]`).evaluate((el, val) => {
    const i = el; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, String(val));
    i.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
const preview = await p.locator('[data-testid="tool-preview"]').textContent();
await p.getByTestId('tool-ok').click();
await p.getByTestId('tool-confirm').click();
await p.waitForSelector('[data-testid="place-label"]', { timeout: 20000 });
await p.getByTestId('place-build').click();
await p.waitForSelector('[data-testid="place-label"]', { state: 'detached', timeout: 10000 });
console.log('preview:', preview?.trim());

// hide the ground AND the starter deck plate so the silhouette is the SKIN
// alone; park the camera for a silhouette-GRAZING view (where a dent shows
// worst), then head-on
await p.evaluate(() => {
  const e = window.__ARCHEAN__.engine;
  e.blueprint.data.blocks.length = 0;
  e.reload();
});
await p.waitForTimeout(1500);
const rr = Math.max(+rx, +ry, +rz);
for (const [name, pos, tgt] of [
  ['edge', [rr * 1.9, Math.max(0.1, +ry * 0.1), rr * 1.9], [0, 0, 0]],
  ['front', [0, +ry * 0.3, rr * 2.6], [0, +ry * 0.1, 0]],
]) {
  await p.evaluate(({ pos, tgt }) => {
    const e = window.__ARCHEAN__.engine;
    e.camera.position.set(pos[0], pos[1], pos[2]);
    e.controls.target.set(tgt[0], tgt[1], tgt[2]);
    e.controls.update();
    // isolate the SKIN for the silhouette read: every scene child group off,
    // every mesh kept only if it lives under the craft root (NOT the camera
    // HUD, NOT the mirror plane, NOT the ground group)
    for (const g of [e.subGroup, e.surgeGroup, e.ghostGroup, e.clusterGroup, e.blockHlGroup,
      e.triHlGroup, e.compHlGroup, e.hingeGroup]) if (g) g.visible = false;
    const under = (o, anc) => { let p = o.parent; while (p) { if (p === anc) return true; p = p.parent; } return false; };
    e.scene.traverse((o) => {
      if (o.isMesh || o.isLine || o.isLineSegments || o.isPoints)
        if (!under(o, e.root) || under(o, e.camera) || under(o, e.mirrorPlane) || under(o, e.groundGroup))
          o.visible = false;
    });
    e.invalidate?.();
  }, { pos, tgt });
  await p.waitForTimeout(1200);
  const file = /\.png$/.test(out) ? out.replace(/\.png$/, `-${name}.png`) : `${out}-${name}.png`;
  await p.screenshot({ path: file });
  // floating DOM UI (side panel, cards, mode widget, debug strip) overlaps
  // the canvas bbox — hide it so the mask is the SKIN alone
  await p.addStyleTag({ content: 'aside, .ksp-win, [data-testid="scene-stats"], [data-testid="modebox"], [data-testid="twin-warn"] { display: none !important; }' });
  await p.waitForTimeout(150);
  // silhouette analysis on the CANVAS pixels only (no UI panels in the mask)
  const buf = await p.locator('canvas').screenshot();
  const fill = await p.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    // Sky-family background (scene.background = #8fb4d8) vs the skin. Then:
    //  • subsample 2px, label connected components, keep the LARGEST blob
    //    (a stray floating widget or two in a corner must not join the hull);
    //  • AREA = scanline spans per row — fills the specular-highlight holes
    //    inside the blob WITHOUT filling a real bite out of the silhouette;
    //  • FILL = blob span-area / its convex hull area; 1.000 = the rendered
    //    silhouette is convex ⇒ the picture has no dent anywhere.
    const sky = (r, g, b) => Math.abs(r - 0x8f) + Math.abs(g - 0xb4) + Math.abs(b - 0xd8) < 120;
    const GW = Math.floor(c.width / 2), GH = Math.floor(c.height / 2);
    const grid = new Uint8Array(GW * GH);
    for (let j = 0; j < GH; j++)
      for (let i = 0; i < GW; i++) {
        const k = (j * 2 * c.width + i * 2) * 4;
        grid[j * GW + i] = sky(d[k], d[k + 1], d[k + 2]) ? 0 : 1;
      }
    // largest connected component (BFS)
    const lab = new Int32Array(GW * GH).fill(-1);
    let best = -1, bestN = 0, next = 0;
    const stack = [];
    for (let s = 0; s < GW * GH; s++) {
      if (grid[s] !== 1 || lab[s] >= 0) continue;
      let n = 0;
      stack.push(s); lab[s] = next;
      while (stack.length) {
        const q = stack.pop(); n++;
        const qi = q % GW, qj = (q - qi) / GW;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = qi + di, nj = qj + dj;
          if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          const nq = nj * GW + ni;
          if (grid[nq] === 1 && lab[nq] === -1) { lab[nq] = next; stack.push(nq); }
        }
      }
      if (n > bestN) { bestN = n; best = next; }
      next++;
    }
    if (best < 0 || bestN < 200) return { area: bestN, fill: null };
    // scanline-filled area + boundary points of the blob
    const pts = [];
    let area = 0;
    for (let j = 0; j < GH; j++) {
      let lo = -1, hi = -1;
      for (let i = 0; i < GW; i++) {
        if (lab[j * GW + i] !== best) continue;
        if (lo < 0) lo = i;
        hi = i;
      }
      if (lo < 0) continue;
      area += hi - lo + 1;
      pts.push([lo * 2, j * 2], [hi * 2, j * 2]);
    }
    // Andrew monotone chain convex hull over the scanline extremes
    pts.sort((a, b2) => a[0] - b2[0] || a[1] - b2[1]);
    const cross = (o, a, b2) => (a[0] - o[0]) * (b2[1] - o[1]) - (a[1] - o[1]) * (b2[0] - o[0]);
    const lower = [];
    for (const q of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    const upper = [];
    for (let i2 = pts.length - 1; i2 >= 0; i2--) { const q = pts[i2]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    const hull = lower.concat(upper.slice(1, -1));
    let ha = 0;
    for (let i2 = 0; i2 < hull.length; i2++) {
      const a = hull[i2], b3 = hull[(i2 + 1) % hull.length];
      ha += a[0] * b3[1] - b3[0] * a[1];
    }
    ha = Math.abs(ha) / 2;                      // grid px²
    return { area: area * 4, fill: +(area / (ha / 4) * 4 / 4).toFixed(3) };
  }, buf.toString('base64'));
  console.log(`${name}: object px ${fill.area}, silhouette fill ${fill.fill} (1.000 = convex, no dents)`);
  writeFileSync(file.replace(/\.png$/, '.json'), JSON.stringify(fill));
}
await b.close();
