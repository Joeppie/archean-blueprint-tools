#!/usr/bin/env node
// onebyone.mjs — per-COMPONENT close-up probe of OUR viewer (matrix triage step 2
// taken to its extreme: one component in frame, nothing selected, real models).
// Dev-side comparison stays the full-row <id>-dev.png from devscrape; this tool
// measures OUR scene numerically (node bboxes, label-texture ink, occupancy vs
// part) and saves <id>-comp<N>-<Type>.png crops for the eyeball pass.
//
//   node tools/onebyone.mjs --ids 9000001007,9000001034 --ours http://127.0.0.1:8651
//
// Corpus/viewer are served from the --ours root (repo checkout). No absolute
// machine paths: everything resolves through flags (AGENTS § Blueprint folder).
import { chromium } from '@playwright/test';
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (!process.argv[i].startsWith('--')) continue;
  const k = process.argv[i].slice(2), nx = process.argv[i + 1];
  args[k] = nx && !nx.startsWith('--') ? nx : true;
  if (nx && !nx.startsWith('--')) i++;
}
const OURS = args.ours || 'http://127.0.0.1:8651';
const IDS = (args.ids || '9000001007,9000001034,9000002034,9000001001,9000002001').split(',');
const OUT = args.out || 'reports/onebyone';
const W = Number(args.width || 1280), H = Number(args.height || 900);
mkdirSync(OUT, { recursive: true });

// iGPU pin: never contend the discrete GPU (AGENTS § performance rules)
const browser = await chromium.launch({
  env: { ...process.env, VK_ICD_FILENAMES: '/usr/share/vulkan/icd.d/radeon_icd.json' },
  args: ['--no-sandbox', '--disable-dev-shm-usage',
    '--use-gl=angle', '--use-angle=vulkan', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const report = {};

for (const id of IDS) {
  const url = `${OURS}/viewer/index.html?open=../testdata/${id}/blueprint.json&real`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => {
    const fs = document.getElementById('filestatus');
    return fs && /\d+ components/.test(fs.textContent);
  }, null, { timeout: 90_000 });
  await page.waitForTimeout(3000);                 // lazy real-model settles

  const comps = await page.evaluate(() => {
    const H = window.HARCHEAN;
    const out = [];
    // Vector3 arrives via the page's three import inside view3d: derive the
    // constructor from a live object instead of importing a second module copy
    const V3 = H.camera.position.constructor;
    const bboxOf = (root) => {              // world-space bbox by traversal
      let n = 0, minX = 1e9, minY = 1e9, minZ = 1e9, maxX = -1e9, maxY = -1e9, maxZ = -1e9;
      root.updateWorldMatrix(true, true);
      root.traverse((m) => {
        if (!m.isMesh || !m.visible) return;
        const g = m.geometry; if (!g) return;
        if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox; if (!bb) return;
        const p = new V3();
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y])
          for (const z of [bb.min.z, bb.max.z]) {
            p.set(x, y, z).applyMatrix4(m.matrixWorld);
            n++;
            minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
          }
      });
      return n ? { min: [minX, minY, minZ].map((v) => +v.toFixed(4)),
                   max: [maxX, maxY, maxZ].map((v) => +v.toFixed(4)) } : null;
    };
    const comps = H.model.data.components;
    for (let i = 0; i < comps.length; i++) {
      const c = comps[i];
      const rec = { i, type: c.type,
        pos: [+c.position.x.toFixed(3), +c.position.y.toFixed(3), +c.position.z.toFixed(3)] };
      const proxy = H.compObjs?.[i] || H.compObjs?.get?.(i);
      const roots = [...(H.realMap.get(i) || [])];
      rec.real = roots.length ? bboxOf(roots[0]) : null;   // first root = proxy-sibling root
      // per .ini-node bboxes of the REAL model (userData.node tagging)
      const nodes = {};
      for (const r of roots) r.traverse((m) => {
        if (!m.isMesh || !m.userData?.node) return;
        const b = bboxOf(m);
        if (b) (nodes[m.userData.node] ??= []).push(b);
      });
      rec.nodes = nodes;
      // occupancy: file cell -> world cell centre (v0.180: view space IS the
      // raw file frame — no z negation)
      rec.occ = (c.occupancies || []).map((o) => ({
        cell: [o.pos_x, o.pos_y, o.pos_z],
        centre: [ +(((o.pos_x + o.size_x / 2) - 5.5) * 0.25 + o.frame_x * 3).toFixed(3),
                  +(((o.pos_y + o.size_y / 2) - 5.5) * 0.25 + o.frame_y * 3).toFixed(3),
                  +(((o.pos_z + o.size_z / 2) - 5.5) * 0.25 + o.frame_z * 3).toFixed(3) ],
      }));
      // Dashboard label ink: sample the face material's canvas for dark pixels
      if (c.type === 'Dashboard') {
        rec.labels = [];
        for (const r of roots) r.traverse((m) => {
          if (!m.isMesh) return;
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) {
            const cv = mat?.map?.image;
            if (cv && cv.toDataURL) {
              const g2 = cv.getContext('2d');
              const d = g2.getImageData(0, 0, cv.width, cv.height).data;
              let ink = 0;
              for (let k = 0; k < d.length; k += 4)
                if (d[k] + d[k + 1] + d[k + 2] < 600 && d[k + 3] > 128) ink++;
              rec.labels.push({ canvas: [cv.width, cv.height], ink,
                                frac: +(ink / (cv.width * cv.height)).toFixed(4) });
            }
          }
        });
        // which face carries the map + is it flipped by the mirror chain?
        rec.boardBox = rec.real;
      }
      out.push(rec);
    }
    return out;
  });
  report[id] = comps;

  // per-component close-ups: nothing selected, ground/grid/occ/labels hidden
  for (const rec of comps) {
    if (!rec.real) continue;
    const shot = await page.evaluate(({ i }) => {
      const H = window.HARCHEAN;
      H.select(-1); H.paintHighlights();          // nothing selected in the shot
      H.hideModeBox?.();
      for (const c of H.scene.children) {
        if (c.type === 'GridHelper' || c === H.ground || c === H.occGroup ||
            c === H.aeroArrows || c === H.thrustGroup || c === H.comMarker) c.visible = false;
      }
      const roots = H.realMap.get(i) || [];
      const V3 = H.camera.position.constructor;
      const p = new V3(), c0 = new V3(), c1 = new V3();
      let has = false;
      for (const r of roots) r.traverse((m) => {
        if (!m.isMesh || !m.visible) return;
        if (!has) { p.setFromMatrixPosition(m.matrixWorld); c0.copy(p); c1.copy(p); has = true; }
        // merge mesh world bbox corners (coarse: centre + radius via boundingBox)
        const g = m.geometry; if (!g.boundingBox) g.computeBoundingBox();
        const bb = g.boundingBox; const q = new V3();
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y])
          for (const z of [bb.min.z, bb.max.z]) {
            q.set(x, y, z).applyMatrix4(m.matrixWorld);
            c0.min(q); c1.max(q);
          }
      });
      if (!has) return null;
      const ctr = c0.add(c1).multiplyScalar(0.5);
      const size = c1.sub(c0).length();          // recompute extent (c0 consumed)
      const dist = Math.max(0.9, size * 2.2);
      const dir = new V3(0.705, 0.435, -0.560).normalize();
      H.controls.target.copy(ctr);
      H.camera.position.copy(ctr).add(dir.multiplyScalar(dist));
      H.camera.near = 0.01; H.camera.updateProjectionMatrix();
      H.controls.update(); H.invalidate();
      return { ctr: ctr.toArray().map((v) => +v.toFixed(3)) };
    }, { i: rec.i });
    await page.waitForTimeout(500);
    const f = `${OUT}/${id}-comp${rec.i}-${rec.type}.png`;
    await page.screenshot({ path: f });
    report[id][rec.i].shot = { file: f, ctr: shot?.ctr };
  }
  writeFileSync(`${OUT}/${id}.json`, JSON.stringify(report[id], null, 1));
  console.error(`[onebyone] ${id}: ${comps.length} comps -> ${OUT}/`);
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
