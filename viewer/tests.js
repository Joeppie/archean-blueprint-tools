// viewer/tests.js — the viewer's headless test suites (v0.169 split out of
// view3d.js): selftest, proxytest, comptest, uitest, gizmatest, postest.
// The core publishes its internals to window.HARCHEAN (an accessor object of
// live getters + setters) at module evaluation — a GLOBAL handle, deliberately:
// the page loads view3d.js with a cache-bust ?v= query that changes every
// release, and a static import specifier would resolve to a SECOND module
// instance (two apps fighting over one DOM). CDP eval cannot see module scope
// either — every suite reports through document.title / #out (headless
// --dump-dom contract).

import * as THREE from 'three';
import { resolveColor } from './palette.js?v=142';


const H = window.HARCHEAN;   // core hooks (set by view3d.js, always first)
// ---------- proxy verification (?proxytest) ----------
// For every component type in the model atlas: build both the light proxy and
// the real game geometry from the same fake component, compare bounding boxes.
// Proxies are approximations; 35% max per-axis deviation is the tolerance.
async function runProxyTest() {
  await H.loadModelManifest();
  const lines = [];
  let pass = 0, tot = 0;
  for (const t of Object.keys(H.MODEL.manifest || {})) {
    tot++;
    try {
      const mm = await H.getModel(t);
      if (!mm) { lines.push(`${t} SKIP (no geometry)`); continue; }
      const col = (mm.info.colliders && mm.info.colliders[0]) ||
                  { min: [-0.15, -0.15, -0.15], max: [0.15, 0.15, 0.15] };
      const cells = [0, 1, 2].map(a => Math.max(0, Math.round((col.max[a] - col.min[a]) / H.CELL) - 1));
      const fake = {
        type: t, module: 'x', alias: '', colors: {},
        data: t === 'Dashboard' ? { size_x: 60, size_y: 40 } : {},
        // dashboard = GENERATED geometry (centimetres: 60×40 cm = 0.6×0.4 m
        // board, corner pivot); proxy + real paths must agree on that box
        position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 },
        occupancies: [{ frame_x: 0, frame_y: 0, frame_z: 0, pos_x: 5.5, pos_y: 5.5, pos_z: 5.5,
                        size_x: cells[0], size_y: cells[1], size_z: cells[2] }],
      };
      const p = H.buildRealComponent(fake, mm, 1e9, true);     // decimated (default view)
      const r = H.buildRealComponent(fake, mm, 1e9, false);    // full game geometry
      const dp = new THREE.Box3().setFromObject(p).getSize(new THREE.Vector3());
      const dr = new THREE.Box3().setFromObject(r).getSize(new THREE.Vector3());
      const rel = Math.max(...['x', 'y', 'z'].map(a => Math.abs(dp[a] - dr[a]) / Math.max(dr[a], 0.05)));
      const ok = rel <= 0.35;
      if (ok) pass++;
      lines.push(`${t.padEnd(24)} ${ok ? 'OK ' : 'BAD'} proxy ${dp.x.toFixed(2)}×${dp.y.toFixed(2)}×${dp.z.toFixed(2)}`
               + `  real ${dr.x.toFixed(2)}×${dr.y.toFixed(2)}×${dr.z.toFixed(2)}  maxdiff ${(rel * 100).toFixed(0)}%`);
    } catch (e) { lines.push(`${t} ERR ${e.message}`); }
  }
  document.body.insertAdjacentHTML('beforeend', `<pre id="out" style="white-space:pre-wrap">${lines.join('\n')}</pre>`);
  const bad = lines.filter(l => l.includes(' BAD')).slice(0, 4).map(l => l.trim().split(' ')[0]).join(',');
  document.title = `PROXYTEST ${pass}/${tot} PASS bad=${bad || 'none'}`;
}

// ---------- component connector test (?comptest) ----------
// data.pipes endpoints ARE the game's own record of where every port sits
// (0.000 m verified, FORMAT.md § Handedness). One sweep over the default
// craft (ISW-241) tests every component that has a cable: each endpoint must
// have (1) an adapter nub, (2) a cable tube, and (3) the owning component's
// MODEL SURFACE within tolerance — so a wrong component pose shows up as a
// model-vertex miss even when the data-driven nub/tube are right.
// PilotSeat is exempt: the user moved it in the editor (its pitch is not
// axis-aligned, and its pose is not derivable from the .ini).
// Beacon is exempt too: the game records its cable endpoints in the
// connector's own upright frame (p + (0,−0.145,±0.062) for ALL orientations),
// which no reading of the .ini adapter reproduces — the .ini model placement
// and the data-driven tube/nub are each correct in their own frame.
async function runCompTest() {
  let tw = Date.now();      // wait for the blueprint to load (setModel)
  while (!H.model && Date.now() - tw < 10000) await new Promise(r => setTimeout(r, 100));
  const t0 = Date.now();   // let real models load (they are fetched async)
  while (Date.now() - t0 < 8000 && H.compObjs.some((m, i) =>
      m && H.MODEL.manifest?.[m.userData.wType] && !H.realMap.has(i)))
    await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 600));    // adapter nubs merge on a 350 ms debounce
  const d = H.model.data, lines = [];
  let pass = 0, tot = 0;
  const nubVerts = [], tubeVerts = [];
  const grab = (o, arr) => { const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) arr.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld)); };
  H.adpGroup.updateMatrixWorld(true);
  H.adpGroup.traverse(o => { if (o.geometry) grab(o, nubVerts); });
  const tube0 = H.pipeGroup.children[0];          // merged tube mesh (children[1..] = end spheres)
  if (tube0) { tube0.updateWorldMatrix(true, true); grab(tube0, tubeVerts); }
  const modelVerts = (ci) => {
    const objs = H.realMap.get(ci), root = (objs && objs.length && objs[0]) || H.compObjs[ci];
    root.updateWorldMatrix(true, true);
    const out = [];
    root.traverse(o => { if (o.isMesh) { const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) out.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(o.matrixWorld)); } });
    return out;
  };
  const minDist = (v, arr) => { let m = 1e9; for (const w of arr) m = Math.min(m, v.distanceTo(w)); return m; };
  d.pipes.forEach((p, pi) => {
    const ends = H.pipeEndsV.slice(pi * 2, pi * 2 + 2);   // shared model with buildPipes
    for (const e of ends) {
      tot++;
      const type = d.components[e.ci].type;
      const dn_ = minDist(e.v, nubVerts), dt = minDist(e.v, tubeVerts);
      const exempt = type === 'PilotSeat' || type === 'Beacon' || type === 'SolarPanel';
      // SolarPanel exempt from the model-surface check: its geometry is a thin
      // plate with vertices only at the 4 corners (1.44 m wide), and the cable
      // tip sits at the plate's edge mid-region ~0.6 m from the nearest corner
      // — nub+tube carry its alignment.
      const dm = exempt ? 0 : minDist(e.v, modelVerts(e.ci));
      const ok = dn_ <= 0.06 && dt <= 0.06 && (exempt || dm <= 0.35);
      if (ok) pass++;
      else lines.push(`pipe${pi} ${type}#${e.ci} port ${e.port}`
        + ` nub=${dn_.toFixed(3)} tube=${dt.toFixed(3)} model=${exempt ? 'exempt' : dm.toFixed(3)}`);
    }
  });
  document.body.insertAdjacentHTML('beforeend',
    `<pre id="out" style="white-space:pre-wrap">${lines.join('\n') || 'all connectors aligned'}</pre>`);
  document.title = `COMPTEST ${pass}/${tot} PASS bad=${lines.length ? lines[0].split(' ')[1] : 'none'}`;
}

// ---------- position tests (?postest&open=<craft>) ----------
// Placement FIXTURES: named positional/boundary checks on the rendered scene,
// keyed per workshop id — these are craft-specific ground-truth probes, the
// deliberate exception to regtest's "generic only" rule (fixtures are allowed
// to name constants; the suite auto-skips craft without a fixture list).
// Expected values come from the game's own records: file positions and
// data.pipes endpoints (pipeEndsV). One junction lesson drives the RCS set:
// FluidJunctions of ISW-241 (modern, conjugate quats) and RCS-infinity
// (3518436870, legacy raw quats) are byte-identical in the files — they must
// render byte-identical, comb flat, ports touching their cable endpoints.
// Report: <pre id=out> lines 'PASS/FAIL name: detail' + title
// 'POSTEST pass/total PASS bad=names' (headless) — quick, positions only.
const POSTESTS = {
  '3812927875': (ctx) => {
    const { fjBoxes, fjIdx } = ctx;
    T('isw-fj-flat', () => {                       // display pose: comb lies flat
      for (const [ci, bb] of fjBoxes) {
        const sy = bb.getSize(tmpV).y;
        if (sy > 0.40) return `FJ#${ci} bbox y-size ${sy.toFixed(2)} m (expect ≤0.40: flat)`;
      }
      return true;
    });
    T('isw-fj-row', () => {                        // row along z at one height
      const cs = fjIdx.map(ci => fjBoxes.find(a => a[0] === ci)[1]
        .getCenter(new THREE.Vector3()));
      const ys = cs.map(v => v.y), zs = cs.map(v => v.z).sort((a, b) => a - b);
      if (Math.max(...ys) - Math.min(...ys) > 0.02) return `y spread ${(Math.max(...ys) - Math.min(...ys)).toFixed(2)}`;
      for (let i = 1; i < zs.length; i++)
        if (Math.abs(zs[i] - zs[i - 1] - 1) > 0.02) return `z gap ${zs[i] - zs[i - 1]}`;
      return true;
    });
    T('isw-fj-cable-side', () => {                 // cables leave below the deck
      for (const e of H.pipeEndsV.filter(e => fjIdx.includes(e.ci))) {
        const bb = fjBoxes.find(a => a[0] === e.ci)[1];
        if (e.v.y > bb.getCenter(tmpV).y + 0.06) return `pipe end y=${e.v.y.toFixed(2)} above comb mid y=${tmpV.y.toFixed(2)}`;
        if (e.v.y < bb.min.y - 0.35) return `pipe end y=${e.v.y.toFixed(2)} far below comb y=${bb.min.y.toFixed(2)}`;
      }
      return true;
    });
    T('isw-fj-touch', () => {                      // ports at their comb sockets
      // 0.20 m: cable tips sit on the VISIBLE socket (FORMAT.md), which sits
      // 0.14 m off the proxy collider box; a rotated pose lands 0.27+ m off.
      for (const e of H.pipeEndsV.filter(e => fjIdx.includes(e.ci))) {
        const bb = fjBoxes.find(a => a[0] === e.ci)[1];
        const d = bb.distanceToPoint(e.v);
        if (d > 0.20) return `port ${e.port} ${d.toFixed(2)} m off bbox`;
      }
      return true;
    });
    T('symselect', () => {         // v0.164 (user: "I dont see the mirror-
      // component being identified and co-selected"): selecting a twin-
      // paired part must GLOW the twin with it (shared pulsing x-ray pair)
      // and box it in its own golden outline; ⇄ OFF drops both; deselect
      // clears everything.
      const ent = [...H.symTwinIndex().entries()].find(([, ts]) => ts.length);
      if (!ent) return 'no twin pair on ISW';
      const [i, ts] = ent, j = ts[0][0];
      const a0 = H.symOn;
      H.select(i, false); H.symOn = true; H.paintHighlights();
      const tset = new Set(); H.compObjs[j]?.traverse(o => tset.add(o));
      const glow = H.selPairs.some(([o]) => tset.has(o));
      const box = H.selBox2.visible === true;
      H.symOn = false; H.paintHighlights();
      const off = !H.selPairs.some(([o]) => tset.has(o)) && !H.selBox2.visible;
      H.symOn = a0; H.select(-1); H.paintHighlights();
      const cleared = !H.selBox.visible && !H.selBox2.visible;
      return (glow && box && off && cleared)
        || `glow=${glow} box=${box} off=${off} cleared=${cleared}`;
    });
    T('symrot', () => {          // v0.165 (user: "manipulation of its
      // rotation does NOT affect the counterpart"): a gizmo rotation spin
      // propagates MIRRORED to the twin — mirror conjugation flips pitch/
      // yaw and preserves roll — so a view-frame Rz(+0.2) on one ISW
      // aileron must land as Rz(−0.2) on its twin (sign-sensitive), with
      // the twin's FILE quaternion following its view pose; the reverse
      // spin restores everything.
      const ent = [...H.symTwinIndex().entries()].find(([i2, ts]) => ts.length
        && H.model.data.components[i2].type === 'Aileron');
      if (!ent) return 'no aileron twin pair';
      const [i, ts] = ent, j = ts[0][0];
      const oi = H.compObjs[i], oj = H.compObjs[j];
      if (!oi || !oj) return 'aileron proxies missing';
      const a0 = H.symOn; H.symOn = true;
      H.select(i, false);
      const qi0 = oi.quaternion.clone(), qj0 = oj.quaternion.clone();
      const qv = qi0.clone().multiply(new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2))
        .multiply(H.GIZMO_Y180);                   // qW; qW·Y180 = target qv
      H.applyGizmoOrientation(qv);
      const dj = oj.quaternion.clone().multiply(qj0.clone().invert());
      const okRot = dj.z < -0.0995 && dj.z > -0.1005
        && Math.abs(dj.x) < 1e-9 && Math.abs(dj.y) < 1e-9;
      const of = H.model.data.components[j].orientation;
      const rf = H.rawFromView(oj, oj.quaternion);
      const okFile = Math.abs(of.w - rf.w) < 1e-9 && Math.abs(of.x - rf.x) < 1e-9
        && Math.abs(of.y - rf.y) < 1e-9 && Math.abs(of.z - rf.z) < 1e-9;
      H.applyGizmoOrientation(qi0.clone().multiply(H.GIZMO_Y180));  // restore spin
      const okBack = Math.abs(oj.quaternion.dot(qj0)) > 1 - 1e-9;
      H.symOn = a0; H.select(-1); H.paintHighlights();
      return (okRot && okFile && okBack)
        || `rot=${okRot}(${dj.z.toFixed(4)}) file=${okFile} back=${okBack}`;
    });
    T('symrot-x', () => {         // v0.166 (user: "rotate two wheels …
      // all axes behave correctly, exact the one that is red. If I move
      // my wheel back, the mirrored wheel moves forward"): the spin
      // component along the mirror NORMAL is PRESERVED — rolling one
      // ISW SmallWheel pair member (x=±3.125) about x̂ (red) by +0.2 must
      // roll its twin the SAME way, Rx(+0.2) (sign-sensitive; the
      // v0.165 code flipped it), with the twin's file quaternion
      // following; the counter-spin restores everything.
      const ent = [...H.symTwinIndex().entries()].find(([i2, ts]) => ts.length
        && H.model.data.components[i2].type === 'SmallWheel');
      if (!ent) return 'no SmallWheel twin pair';
      const [i, ts] = ent, j = ts[0][0];
      const oi = H.compObjs[i], oj = H.compObjs[j];
      if (!oi || !oj) return 'wheel proxies missing';
      const a0 = H.symOn; H.symOn = true;
      H.select(i, false);
      const qi0 = oi.quaternion.clone(), qj0 = oj.quaternion.clone();
      // v0.167: capture the gesture pivots like mouseDown does (self =
      // gizmo centre, twin = twin's own centre) and assert the twin
      // ORBITS its centre (radius constant, not levered about its origin).
      H.scene.updateMatrixWorld(true);
      H.gizPivotL = new THREE.Box3().setFromObject(oi)
        .getCenter(new THREE.Vector3()).sub(H.compGroup.position);
      H.symRotPiv.clear();
      H.symRotPiv.set(j, new THREE.Box3().setFromObject(oj)
        .getCenter(new THREE.Vector3()).sub(H.compGroup.position));
      const cj = H.symRotPiv.get(j), pj0 = oj.position.clone();
      const qv = qi0.clone().multiply(new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2))
        .multiply(H.GIZMO_Y180);
      H.applyGizmoOrientation(qv);
      const dj = oj.quaternion.clone().multiply(qj0.clone().invert());
      const okX = dj.x > 0.0995 && dj.x < 0.1005
        && Math.abs(dj.y) < 1e-9 && Math.abs(dj.z) < 1e-9;
      const okPiv = Math.abs(oj.position.distanceTo(cj)
        - pj0.distanceTo(cj)) < 1e-9;
      const of = H.model.data.components[j].orientation;
      const rf = H.rawFromView(oj, oj.quaternion);
      const okFile = Math.abs(of.w - rf.w) < 1e-9 && Math.abs(of.x - rf.x) < 1e-9
        && Math.abs(of.y - rf.y) < 1e-9 && Math.abs(of.z - rf.z) < 1e-9;
      H.applyGizmoOrientation(qi0.clone().multiply(H.GIZMO_Y180));  // restore spin
      const okBack = Math.abs(oj.quaternion.dot(qj0)) > 1 - 1e-9
        && oj.position.distanceTo(pj0) < 1e-9;
      H.symOn = a0; H.gizPivotL = null; H.symRotPiv.clear();
      H.select(-1); H.paintHighlights();
      return (okX && okFile && okBack && okPiv)
        || `rot=${okX}(${dj.x.toFixed(4)}) file=${okFile} back=${okBack}`
        + ` piv=${okPiv}`;
    });
  },
  // v0.155 aero GRID pins: the giant (1024 plates ≥ AERO_GRID_MIN) is the
  // only corpus craft whose wind runs on the grid, so its soundness (the
  // 3x3x3 query returns a SUPERSET of the influencing plates — the exact
  // slab/r2 tests then run on it, so streamlines are bit-identical) has to
  // be pinned here; ISW-class pins only cover the scan path.
  '3509975859': () => {
    T('giant-grid-on', () =>
      (H.aeroUseGrid && H.aeroGrid.size > 0) || `grid off (plates=${H.aeroPlates.length})`);
    T('giant-grid-superset', () => {
      const b = H.model.box_min, B = H.model.box_max;
      for (let k = 1; k <= 250; k++) {                       // golden-ratio fill
        const p = [b.x + (k * 0.6180339887 % 1) * (B.x - b.x),
                   b.y + (k * 0.7548776662 % 1) * (B.y - b.y),
                   b.z + (k * 0.5698402910 % 1) * (B.z - b.z)];
        const near = H.platesNear(p);
        for (let i = 0; i < H.aeroPlates.length; i++) {
          const pl = H.aeroPlates[i];
          const d = (p[0] - pl.c[0]) * pl.n[0] + (p[1] - pl.c[1]) * pl.n[1] + (p[2] - pl.c[2]) * pl.n[2];
          if (Math.abs(d) > 0.5) continue;                   // sampleVel's exact filter
          const qd2 = (p[0] - pl.c[0]) ** 2 + (p[1] - pl.c[1]) ** 2 + (p[2] - pl.c[2]) ** 2 - d * d;
          if (qd2 > pl.R * pl.R + 0.5) continue;
          if (!near.includes(pl))
            return `plate ${i} influences p=${p.map(v => v.toFixed(1))} but grid missed it`;
        }
      }
      return true;
    });
    T('giant-grid-inflow', () => {                           // freestream far upstream
      const b = H.model.box_min, B = H.model.box_max;
      const v = H.sampleVel([(b.x + B.x) / 2, (b.y + B.y) / 2, b.z - 8], [0, 0, 1], 12);
      return (Math.abs(v[2] - 12) < 1e-6 && Math.abs(v[0]) < 1e-6 && Math.abs(v[1]) < 1e-6)
        || `upstream v=${v.map(x => x.toFixed(2))} (expect 0,0,12)`;
    });
    T('giant-grid-wake', () => {
      // Deficit behind the body: sample the FIRST cells buildSolid inserted
      // (blocks first, densest structure; Set order is insertion order =
      // deterministic), stand 2 cells (0.5 m) downstream of each along each
      // axis — the wake ray walks 0.25 m steps upstream and must hit the
      // anchor cell. (bbox-face probes fly through air: the giant's sparse
      // skin leaves the face grids between stringers.)
      let tested = 0, mx = 0;
      outer:
      for (const key of H.solidCells) {
        const z = key % 8192 - 4096, y = (key - (z + 4096)) / 8192 % 8192 - 4096,
              x = (key - (z + 4096) - (y + 4096) * 8192) / 67108864 - 4096;
        for (let ax = 0; ax < 3; ax++) {
          const p = [x * 0.25 + 0.125, y * 0.25 + 0.125, z * 0.25 + 0.125];
          p[ax] = (p[ax] - 0.125) + 0.5;
          const dir = ax === 0 ? [1, 0, 0] : ax === 1 ? [0, 1, 0] : [0, 0, 1];
          const v = H.sampleVel(p, dir, 12);
          if (v.length > 3) mx = Math.max(mx, v[3]);
          tested++;
        }
        if (tested >= 90) break outer;
      }
      return mx > 0.25 || `max wake deficit ${mx.toFixed(2)} (expect >0.25 behind body, ${tested} probes)`;
    });
  },
  '3732302108': () => {              // mosaic gantry: LinearTrack master SLIDES its subgrid
    T('subjoint-pos', () => {
      const g = H.subGroup.children.find(o => (H.subMasterEntries().get(o.userData.sub) || [])
        .some(e => H.model.data.components[e.component]?.type === 'LinearTrack'));
      if (!g) return 'no LinearTrack-mastered subgrid';
      const e = (H.subMasterEntries().get(g.userData.sub) || [])
        .find(x => H.model.data.components[x.component]?.type === 'LinearTrack');
      const mc = H.model.data.components[e.component];
      const { axis } = H.subJointAxis(mc);
      const p0 = g.position.clone(), p1 = mc.data.pos;
      mc.data.pos = p1 + 0.25; H.syncSubJoints();
      const d = g.position.clone().sub(p0).normalize();
      const hit = d.dot(axis) > 0.9999;                 // slide along the axle axis
      mc.data.pos = p1; H.syncSubJoints();
      return (hit && g.position.distanceTo(p0) < 1e-9)
        || `slide not axle-aligned (dot=${d.dot(axis).toFixed(3)})`;
    });
  },
  '3518436870': (ctx) => {
    const { fjBoxes, fjIdx, comps } = ctx;
    T('rcs-fj-flat', () => {                       // legacy raw-quat file: same flat comb
      for (const [ci, bb] of fjBoxes) {
        const sy = bb.getSize(tmpV).y;
        if (sy > 0.40) return `FJ#${ci} bbox y-size ${sy.toFixed(2)} m (expect ≤0.40: flat, matches ISW byte-identical quat)`;
      }
      return true;
    });
    T('rcs-fj-row', () => {                        // row height ≈ file position y 0.88
      for (const [ci, bb] of fjBoxes) {
        const y = bb.getCenter(tmpV).y, fy = comps[ci].position.y;
        if (Math.abs(y - fy) > 0.25) return `FJ#${ci} centre y=${y.toFixed(2)} vs file y=${fy.toFixed(2)}`;
      }
      return true;
    });
    T('rcs-fj-cable-side', () => {
      for (const e of H.pipeEndsV.filter(e => fjIdx.includes(e.ci))) {
        const bb = fjBoxes.find(a => a[0] === e.ci)[1];
        if (e.v.y > bb.getCenter(tmpV).y + 0.06) return `pipe end y=${e.v.y.toFixed(2)} above comb mid y=${tmpV.y.toFixed(2)}`;
        if (e.v.y < bb.min.y - 0.35) return `pipe end y=${e.v.y.toFixed(2)} far below comb y=${bb.min.y.toFixed(2)}`;
      }
      return true;
    });
    T('rcs-fj-touch', () => {
      for (const e of H.pipeEndsV.filter(e => fjIdx.includes(e.ci))) {
        const bb = fjBoxes.find(a => a[0] === e.ci)[1];
        const d = bb.distanceToPoint(e.v);
        if (d > 0.20) return `port ${e.port} ${d.toFixed(2)} m off bbox (pose rotated?)`;
      }
      return true;
    });
  },
  '3417786605': () => {                        // GNG-574 dolphin: 5 door subgrids
    const subs = () => H.subGroup.children.filter(o => o.userData.sub !== undefined);
    T('sub-groups', () => subs().length === 5 ? true : `${subs().length} subgrid groups (expect 5)`);
    T('sub-pick-front', () => {         // subgrid in FRONT wins over the hull behind it
      const g = subs()[0];
      if (!g) return 'no subgrid groups';
      const bb = new THREE.Box3().setFromObject(g);
      if (bb.isEmpty()) return 'subgrid bbox empty';
      const c = bb.getCenter(new THREE.Vector3());
      const whole = new THREE.Box3();
      for (const gg of [H.compGroup, H.blockGroup, H.hullGroup, H.subGroup]) whole.expandByObject(gg);
      const out = c.clone().sub(whole.getCenter(new THREE.Vector3())).normalize();
      const rc = new THREE.Raycaster(c.clone().addScaledVector(out, 3), out.clone().negate());
      const hc = rc.intersectObjects(H.compGroup.children, true);
      const hs = rc.intersectObjects(H.subGroup.children, true);
      const dc = hc.length ? hc[0].distance : Infinity, ds = hs.length ? hs[0].distance : Infinity;
      if (!(ds < dc)) return `component hit ${dc.toFixed(2)} m before subgrid ${ds.toFixed(2)} m`;
      let o = hs[0].object, s = -1;
      while (o && s < 0) { s = o.userData.sub ?? -1; o = o.parent; }
      if (s !== g.userData.sub) return `hit routed to sub=${s}, want ${g.userData.sub}`;
      // v0.169 routing: a hit on VISIBLE subgrid content in front of any
      // component must reach pickRay as the subgrid (the rule that survived
      // the component-first change)
      let wv = true;
      for (let p = hs[0].object; p; p = p.parent) if (!p.visible) { wv = false; break; }
      if (wv) {
        H.ray.set(rc.ray.origin, rc.ray.direction);
        const res = H.pickRay();
        return res.sub === g.userData.sub
          || `pickRay gave ${JSON.stringify(res)}, want sub=${g.userData.sub}`;
      }
      return true;
    });
    T('sublist', () => {              // v0.169: the by-subgrid tab lists
      const prev = H.listTab;        // EVERY subgrid as its own row (the
      H.listTab = 'sub';             // old nested-only listing hid the
      let err = '';                   // blocks-only ones and THREW at the
      try { H.buildList(); } catch (e) { err = String(e.message); }
      const rows = [...H.$('complist').querySelectorAll('.grp > div[data-b]')]
        .filter(d => d.querySelector('.t')?.textContent.startsWith('SUBGRID'));
      const nB = H.model.data.components.filter(c => c.type === 'Build'
        && c.data?.blocks?.length).length;
      const okN = rows.length === nB;
      rows[0].click();                // row click selects the SUBGRID
      const okSel = H.selectedSub === +rows[0].dataset.idx && H.selectedSub >= 0;
      H.listTab = prev; H.buildList(); H.select(-1); H.paintHighlights();
      return (okN && okSel) || `rows=${rows.length}/${nB} sel=${H.selectedSub} err=${err}`;
    });
    T('subwidget', () => {            // v0.170 (user: "i can select and move
      const g = subs()[0];           // or rotate a subgrid. that is WRONG"):
      if (!g) return 'no subgrids';  // selecting a SUBGRID detaches the
      const o = H.compObjs.find(Boolean);   // gizmo and hides the mode
      if (!o) return 'no components';       // widget; component selection
      H.setGizmoMode('move');               // keeps both (gizmatest pins
      H.select(H.compObjs.indexOf(o));      // the component side).
      const compOk = H.tctl.object === H.gizmoProxy;
      H.showModeBox(50, 50, o);
      const shown = H.modeBox.classList.contains('vis');
      H.selectSub(g.userData.sub);
      const off = !H.tctl.object && !H.modeBox.classList.contains('vis');
      H.setGizmoMode('rotate'); H.select(-1); H.paintHighlights();
      return (compOk && shown && off) || `comp=${compOk} shown=${shown} off=${off}`;
    });
    T('subglow', () => {              // v0.169 (user: "subgrid should
      const g = subs()[0];           // highlight as a whole/wireframe so we
      if (!g) return 'no subgrids';  // understand its a subgrid"): x-ray
      H.selectSub(g.userData.sub);   // glow over the WHOLE content tree +
      H.scene.updateMatrixWorld(true); // the golden outline box around it
      H.paintHighlights();           // re-paint with fresh world matrices
      let n = 0, nMesh = 0;
      g.traverse(o => { if (o.isMesh) nMesh++; });
      for (const [o] of H.selPairs) {
        let p = o;
        while (p) { if (p === g) { n++; break; } p = p.parent; }
      }
      const bb = new THREE.Box3().setFromObject(g);
      const c = bb.getCenter(new THREE.Vector3());
      // golden box geometry = 12 edge segments; compare its EXTENT centre
      // (start+end vertices — a start-points-only mean is corner-unbalanced)
      const sp = H.selBox.geometry.getAttribute('instanceStart');
      const ep = H.selBox.geometry.getAttribute('instanceEnd');
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (let i = 0; i < sp.count; i++)
        for (const p of [sp, ep])
          for (let a = 0; a < 3; a++) {
            const v = [p.getX(i), p.getY(i), p.getZ(i)][a];
            mn[a] = Math.min(mn[a], v); mx[a] = Math.max(mx[a], v);
          }
      const bc = new THREE.Vector3((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2);
      const okBox = H.selBox.visible && bc.distanceTo(c) < 0.15;
      const dbg = `glow=${n}/${nMesh} box=${H.selBox.visible}`
        + ` c=${c.toArray().map(v => v.toFixed(2))} bc=${bc.toArray().map(v => v.toFixed(2))}`
        + ` sub=${H.selectedSub} g=${g.userData.sub} vis2=${H.selBox2.visible}`;
      H.select(-1); H.paintHighlights();
      return (n >= Math.min(nMesh, 2) && okBox) || dbg;
    });
    T('compglow', () => {             // v0.170 (user: "the highlight effect
      // is good and should alsways happen for xomponents"): the REAL game
      // models of a selected component get the x-ray overlay too (proxy
      // boxes are hidden under real geometry — proxy-only glow read as a
      // box-shaped ghost of the part).
      const i2 = H.model.data.components.findIndex((c, k2) =>
        (H.realMap.get(k2)?.length || 0) > 0 && c.type === 'Beacon');
      if (i2 < 0) return 'no real-loaded component';
      H.select(i2);
      const roots = new Set(H.realMap.get(i2));
      const n = H.selPairs.filter(([o]) => {
        for (let p2 = o; p2; p2 = p2.parent) if (roots.has(p2)) return true;
        return false;
      }).length;
      H.select(-1); H.paintHighlights();
      return n > 0 || `selPairs=${H.selPairs.length} none under real roots`;
    });
    T('sub-info', () => {              // click-equivalent opens the subgrid panel
      if (!subs().length) return 'no subgrids';
      H.selectSub(subs()[0].userData.sub);
      const nm = document.getElementById('selname').textContent;
      const ins = document.getElementById('inspector').textContent;
      H.selectSub(-1);
      // decoded master of Build[4] (v0.154 join): SmallTurboPump[47]
      return (/Subgrid/.test(nm) && /Pivot offset/.test(ins) && /Pivot rotation/.test(ins)
        && /SmallTurboPump\[47\]/.test(ins))
        || `panel missing decoded mount (nm='${nm.slice(0, 40)}')`;
    });
    T('sub-masters', () => {          // decoded join: 1 entry per subgrid
      const m = H.subMasterEntries();
      let tot = 0; for (const v of m.values()) tot += v.length;
      if (tot !== 5) return `${tot} decoded entries (expect 5)`;
      const e22 = (m.get(22) || []).map(e => H.model.data.components[e.component]?.type).join();
      return e22 === 'SmallPivot' || `Build[22] master: ${e22} (want SmallPivot)`;
    });
    T('sub-pivot-edit', () => {        // pivot rows move the group live + stay plain in the file
      const g = subs()[0];
      if (!g) return 'no subgrids';
      const bc = H.model.data.components[g.userData.sub];
      const px = bc.position.x, gx = g.position.x;
      bc.position.x = px + 0.4; g.userData.base.p.copy(H.viewPos(bc.position)); H.syncSubJoints();
      const moved = Math.abs(g.position.x - (gx + 0.4)) < 1e-9
        && Number.isFinite(bc.orientation.x) && Number.isFinite(bc.orientation.w);
      bc.position.x = px; g.userData.base.p.copy(H.viewPos(bc.position)); H.syncSubJoints();
      return moved || 'group did not track pivot edit';
    });
    T('subjoint-angle', () => {        // master joint state DRIVES the subgrid (v0.157)
      const g = subs().find(o => (H.subMasterEntries().get(o.userData.sub) || [])
        .some(e => H.model.data.components[e.component]?.type === 'SmallPivot'
                && H.model.data.components[e.component]?.data?.angle === 0));
      if (!g) return 'no SmallPivot-mastered subgrid at angle 0';
      const e = (H.subMasterEntries().get(g.userData.sub) || [])
        .find(e => H.model.data.components[e.component]?.type === 'SmallPivot');
      const mc = H.model.data.components[e.component];
      const { axis, pivot } = H.subJointAxis(mc);
      const bq = g.quaternion.clone(), bp = g.position.clone();
      mc.data.angle = 90; H.syncSubJoints();
      const qOff = bq.clone().invert().multiply(g.quaternion);        // base⁻¹·q = base⁻¹·R(axis,90)·base
      const bax = axis.clone().applyQuaternion(bq.clone().invert());
      const dAx = new THREE.Vector3(qOff.x, qOff.y, qOff.z).normalize();
      const piv = Math.abs(g.position.distanceTo(
        bp.clone().sub(pivot).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 2)).add(pivot))) < 1e-9;
      mc.data.angle = 0; H.syncSubJoints();
      const back = g.quaternion.angleTo(bq) < 1e-6 && g.position.distanceTo(bp) < 1e-9;
      return (Math.abs(qOff.angleTo(new THREE.Quaternion().setFromAxisAngle(bax, Math.PI / 2))) < 1e-6
        && dAx.dot(bax) > 0.9999      // SIGN-sensitive: +angle spins +axis (right-hand, view)
        && piv && back)
        || `spin q=${qOff.angleTo(bq).toFixed(3)} dot=${dAx.dot(bax).toFixed(3)} pivot=${piv} back=${back}`;
    });
            T('symmove', () => {             // v0.160: a gizmo move propagates to the
      // left-right TWIN component (dolphin's twin tail-door hinges ±1.125):
      // file delta (dx,dy,dz) → twin (−dx,dy,dz); pose stays its own.
      const ent = [...H.symTwinIndex().entries()]
        .find(([i, ts]) => ts.length && H.model.data.components[i].type === 'SmallHinge');
      if (!ent) return 'no SmallHinge twin pair';
      const [i, ts] = ent, j = ts[0][0];
      const ci = H.model.data.components[i], cj = H.model.data.components[j];
      const p0i = { ...ci.position }, p0j = { ...cj.position };
      H.select(i); H.setGizmoMode('move');
      const o = H.compObjs[i];
      o.position.set(o.position.x + 0.25, o.position.y, o.position.z);
      // pW = proxy world pos under CENTRE attachment = part world + offset (v0.163)
      H.applyGizmoPosition(o.position.clone().add(H.compGroup.position).add(H._gizOff));
      const d = { x: ci.position.x - p0i.x, y: ci.position.y - p0i.y, z: ci.position.z - p0i.z };
      const dj = { x: cj.position.x - p0j.x, y: cj.position.y - p0j.y, z: cj.position.z - p0j.z };
      const okm = Math.abs(d.x - 0.25) < 1e-9 && Math.abs(dj.x + 0.25) < 1e-9
        && Math.abs(dj.y) < 1e-9 && Math.abs(dj.z) < 1e-9;
      ci.position.x = p0i.x; ci.position.y = p0i.y; ci.position.z = p0i.z;
      cj.position.x = p0j.x; cj.position.y = p0j.y; cj.position.z = p0j.z;
      H.compObjs[i].position.set(p0i.x, p0i.y, -p0i.z);
      H.compObjs[j].position.set(p0j.x, p0j.y, -p0j.z);
      H.syncAdapters(H.compObjs[i]); H.syncAdapters(H.compObjs[j]); H.markDirty();
      return okm || `self=${JSON.stringify(d)} twin=${JSON.stringify(dj)}`;
    });
    T('mirrorplane', () => {         // v0.161: symmetric craft shows the
      // striped sheet + frame + ⇄ pair, it RESTS on the ground (nothing
      // renders below ground — overlays included), and the View-Options
      // checkbox toggles it.
      const t = H.viewToggles.mirror;
      if (!t) return 'no mirror toggle in View Options';
      const kids = H.mirrorGroup.children.length;
      if (!kids) return 'no plane built on a symmetric craft';
      const sheet = H.mirrorGroup.children[0];
      const bbP = new THREE.Box3().setFromObject(sheet);
      const sits = bbP.min.y > H.ground.position.y - 1e-6;
      const arrows = H.mirrorGroup.children.filter(o => o.type === 'ArrowHelper').length;
      t.cb.checked = false; t.cb.dispatchEvent(new Event('change'));
      const hidden = !H.mirrorGroup.visible;
      t.cb.checked = true; t.cb.dispatchEvent(new Event('change'));
      return (kids === 4 && sits && arrows === 2 && hidden && H.mirrorGroup.visible)
        || `kids=${kids} sits=${sits} arrows=${arrows} hidden=${hidden}`;
    });
  },
  '3803780241': () => {              // XYQ-615: 2 subgrids, pair-unique decode
    T('xyq-sub-masters', () => {
      const m = H.subMasterEntries();
      const g = (bi) => (m.get(bi) || []).map(e => H.model.data.components[e.component]?.type).join();
      const a = g(41), b = g(5);
      return (a === 'ToggleButton' && b === 'Dashboard') || `Build[41]=${a} Build[5]=${b}`;
    });
            T('symselect-sub', () => {      // v0.164: subgrid twins co-select too —
      // selecting the XYQ door subgrid Build[41] must glow twin Build[5]'s
      // GROUP with it (x-ray pair) and box it; ⇄ OFF drops both.
      const g = H.subGroup.children.find(o => o.userData.sub === 41);
      const tg = H.subGroup.children.find(o => o.userData.sub === 5);
      if (!g || !tg) return 'twin Build groups missing';
      const a0 = H.symOn;
      H.symOn = true; H.selectSub(41);
      const tset = new Set(); tg.traverse(o => tset.add(o));
      const glow = H.selPairs.some(([o]) => tset.has(o));
      const box = H.selBox2.visible === true;
      H.symOn = false; H.paintHighlights();
      const off = !H.selPairs.some(([o]) => tset.has(o)) && !H.selBox2.visible;
      H.symOn = a0; H.selectSub(-1);
      return (glow && box && off) || `glow=${glow} box=${box} off=${off}`;
    });
      },
};
// harness state at module scope: the POSTESTS fixture closures above capture
// this scope, so T/tmpV must live here (runPosTest resets the counters).
const tmpV = new THREE.Vector3();
let ptLines = [], ptPass = 0, ptTot = 0;
const T = (name, fn) => {
  ptTot++;
  let r = true;
  try { r = fn(); } catch (e) { r = 'threw ' + e.message; }
  if (r === true) { ptPass++; ptLines.push(`PASS ${name}`); }
  else ptLines.push(`FAIL ${name}: ${r}`);
};
// generic button suite: runs on EVERY postest craft (all 24 corpus craft
// have buttons, 22 legacy + 2 modern — this is the format-pair sweep).
// Derivation from the .ini (no rendered-state trust): ToggleButton lever =
// node at (0,−0.16,0) under JOINT axle/axle2 with ZYX euler (18°,0,∓180°),
// so the state-keyed lever centre sits at
//     pivot + qV · mirror_z( Rz(0|−π)·Rx(18°) · (0,−0.16,−0.018) )
// — mirror_z = the viewer's root scale.z=−1, qV = viewQuat (legacy-raw vs
// modern-conjugate aware). A state-agnostic renderer (both levers, or the
// wrong one) fails one-lever; a convention bug fails lever-pose.
const nodeMeshes = (root, name) => {
  const out = [];
  root.traverse(o => { if (o.userData.node === name) out.push(o); });
  return out;
};
function btnSuite(ctx) {
  const { comps, objs } = ctx;
  const RAD = Math.PI / 180;
  // decimated/real models are added to realMap (proxy root hidden) — probe
  // the visible root, same pattern as comptest
  const rootOf = (i) => H.realMap.get(i)?.[0] || objs[i];
  T('btn-one-lever', () => {
    for (const [i, c] of comps.entries()) {
      if (c.type !== 'ToggleButton' || !objs[i]) continue;
      const on = ['switch', 'switch2'].filter(n => nodeMeshes(rootOf(i), n).length);
      if (on.length !== 1) {
        const tags = [];
        rootOf(i).traverse(o => { if (o.userData.node) tags.push(o.userData.node); });
        return `TB#${i} renders ${on.length} levers — have tags=[${tags.join(',')}]`;
      }
    }
    return true;
  });
  T('btn-lever-pose', () => {
    // Game MOUNTS the button base_planes-flush (mount face = plate front,
    // cockpit side), baking a local yaw-180 into the model: the plate covers
    // the hull gap facing the pilot, the lever hides in the wall. Raw
    // file-quat placement puts the plate BEHIND the pivot (dolphin/Cede:
    // "gap in the fuselage, button further back"). View-space lever centre:
    //   pivot + qV · mirror_z( yaw180 · Rx(18°) · Rz(0|−π) · (0,−0.16,−0.018) )
    // (pressed = axle z−180: lever flips UP out of the mount, deck buttons).
    for (const [i, c] of comps.entries()) {
      if (c.type !== 'ToggleButton' || !objs[i]) continue;
      const lever = nodeMeshes(rootOf(i), c.data?.state ? 'switch' : 'switch2')[0];
      if (!lever) return `TB#${i} state=${!!c.data?.state} lever mesh missing`;
      const off = new THREE.Vector3(0, -0.16, -0.018);
      off.applyEuler(new THREE.Euler(18 * RAD, 0, c.data?.state ? -Math.PI : 0, 'ZYX'));
      off.applyEuler(new THREE.Euler(0, Math.PI, 0));           // baked yaw-180
      off.z = -off.z;                                           // root scale.z = −1
      const exp = H.viewPos(c.position).add(off.applyQuaternion(H.viewQuat(c.orientation)));
      const d = new THREE.Box3().setFromObject(lever).getCenter(tmpV).distanceTo(exp);
      if (d > 0.07)
        return `TB#${i} lever centre ${tmpV.toArray().map(v => v.toFixed(2))} vs mounted ${exp.toArray().map(v => v.toFixed(2))} (${d.toFixed(2)} m)`;
    }
    return true;
  });
  T('btn-plate-flush', () => {
    // plate (base) centre under the mount bake: pivot + qV·(0,−0.059,+0.334)
    // view = plate box 0.08 in FRONT of the mount face (file −z = cockpit);
    // raw placement puts it 0.34 BEHIND the pivot (into/behind the wall).
    for (const [i, c] of comps.entries()) {
      if (c.type !== 'ToggleButton' || !objs[i]) continue;
      const base = nodeMeshes(rootOf(i), 'base')[0];
      if (!base) return `TB#${i} base mesh missing`;
      const off = new THREE.Vector3(0, 0.05, 0.335);   // base bbox centre, yaw180+mirror
      const exp = H.viewPos(c.position).add(off.applyQuaternion(H.viewQuat(c.orientation)));
      const d = new THREE.Box3().setFromObject(base).getCenter(tmpV).distanceTo(exp);
      if (d > 0.08)
        return `TB#${i} plate centre ${tmpV.toArray().map(v => v.toFixed(2))} vs mounted ${exp.toArray().map(v => v.toFixed(2))} (${d.toFixed(2)} m — raw yaw?)`;
    }
    return true;
  });
  T('btn-base-single', () => {
    for (const [i, c] of comps.entries()) {
      if (!['ToggleButton', 'PushButton'].includes(c.type) || !objs[i]) continue;
      if (c.data?.isDualSided) continue;
      if (nodeMeshes(rootOf(i), 'base2').length)
        return `${c.type}#${i} draws base2 on a single-sided button (z-fight ghost)`;
    }
    return true;
  });
  T('comp-pick', () => {              // v0.169 (user: "normal component
    // selection prioritizes subgrids, making it impossible to select by
    // looking at a component"): the invisible collider proxy GROUPS of a
    // subgrid's nested parts (flagged !visible when the real model loads;
    // the box mesh inside stays visible — the world-visible walk in
    // pickRay is what demotes them) must not steal a click aimed at a
    // component BEHIND them. The subgrid wins only on visible content
    // (dolphin sub-pick-front) or when the ray hits no component.
    // Generic; crafts with no subgrid-collider-behind-component fixture
    // self-skip.
    const g = H.subGroup.children.find(x =>
      x.children.some(o => o.userData.wType && !o.visible));
    if (!g) return true;             // no nested-real proxy on this craft
    H.scene.updateMatrixWorld(true);
    const cp = g.children.find(o => o.userData.wType && !o.visible)
      .getWorldPosition(new THREE.Vector3());
    const whole = new THREE.Box3();
    for (const gg of [H.compGroup, H.blockGroup, H.hullGroup, H.subGroup])
      whole.expandByObject(gg);
    const out = cp.clone().sub(whole.getCenter(new THREE.Vector3())).normalize();
    // shoot INWARD from just outside the proxy so it is the near hit and a
    // component behind it the far hit (the proxy box has real depth, a
    // from-centre outward shot never registers it)
    H.ray.set(cp.clone().addScaledVector(out, 4), out.clone().negate());
    const hs = H.ray.intersectObjects(H.subGroup.children, true);
    const hc = H.ray.intersectObjects(H.compGroup.children, true);
    if (!hs.length) return true;                               // no near proxy
    let wv = true;
    for (let p = hs[0].object; p; p = p.parent) if (!p.visible) { wv = false; break; }
    if (wv) return true;                                       // visible block hit
    if (!hc.length || hc[0].distance <= hs[0].distance) return true;  // nothing behind
    // full-rule assertion: the invisible proxy demotes; if VISIBLE subgrid
    // content (deck blocks) is closer than the component, the subgrid wins —
    // only a clear shot (no visible subgrid content in front) must land on
    // the component.
    const res = H.pickRay();
    const subOwnerOf = (x) => { for (let p = x; p; p = p.parent)
      if (p.userData.sub !== undefined) return p.userData.sub; return -1; };
    const visd = hs.filter(h => { for (let p = h.object; p; p = p.parent)
      if (!p.visible) return false; return true; });
    const dv = visd.length ? visd[0].distance : Infinity;
    if (dv < hc[0].distance)
      return res.sub === subOwnerOf(visd[0].object)
        || `visible content ${dv.toFixed(2)} m: pickRay gave ${JSON.stringify(res)}`;
    return (res.ci === hc[0].object.userData.ci && res.sub === -1)
      || `pickRay gave ${JSON.stringify(res)}, want comp=${hc[0].object.userData.ci}`;
  });
}
async function runPosTest() {
  let tw = Date.now();
  while (!H.model && Date.now() - tw < 10000) await new Promise(r => setTimeout(r, 100));
  if (!H.model) { document.title = 'POSTEST ERR no model'; return; }
  await new Promise(r => setTimeout(r, 600));      // scene built + merged
  const t0 = Date.now();                           // real/low models load async
  while (Date.now() - t0 < 8000 && H.compObjs.some((m, i) =>
      m && H.MODEL.manifest?.[m.userData.wType] && !H.realMap.has(i)))
    await new Promise(r => setTimeout(r, 100));
  H.compGroup.updateMatrixWorld(true);
  const id = String(H.model.workshop_item_id ?? '');
  const suite = POSTESTS[id];
  ptLines = []; ptPass = 0; ptTot = 0;
  const fjIdx = H.model.data.components
    .map((c, i) => c.type === 'FluidJunction' && H.compObjs[i] ? i : -1).filter(i => i >= 0);
  const fjBoxes = fjIdx.map(ci => [ci, new THREE.Box3().setFromObject(H.compObjs[ci])]);
  const btnCtx = { comps: H.model.data.components, objs: H.compObjs, fjIdx, fjBoxes };
  btnSuite(btnCtx);                                    // generic, every craft
  if (suite) suite(btnCtx);
  document.body.insertAdjacentHTML('beforeend',
    `<pre id="out" style="white-space:pre-wrap">${ptLines.join('\n') || 'no fixtures for ' + id}</pre>`);
  const bad = ptLines.filter(l => l.startsWith('FAIL')).map(l => l.slice(5, l.indexOf(':')));
  document.title = `POSTEST ${ptPass}/${ptTot} ${bad.length ? 'FAIL' : 'PASS'}${suite ? '' : ' SKIP'} bad=${bad.join(',') || 'none'}`;
  if (location.search.includes('subshot')) {    // dev visual state: subgrid panel + widget
    const g = H.subGroup.children.find(o => o.userData.sub !== undefined);
    if (g) {
      H.selectSub(g.userData.sub);
      const es = H.subMasterEntries().get(g.userData.sub);
      if (es?.length) H.flyTo(es[0].component);   // frame the hinge/pivot + driven door
      H.invalidate();
    }
  }
}

// ---------- ?gizmatest: rotation-order contract for the rotate gizmo ----------
// Works on a SYNTHETIC single-component blueprint (one PilotSeat, identity
// orientation) with the camera focused IN FRONT of the seat (pilot faces the
// camera) — the user-suggested isolation for "rotate as it is SHOWN".
// Structure per user: the spin algebra lives in the pure gizmoSpinRing/
// gizmoSpinEye functions (UI-free, asserted here directly); TransformControls
// is configured to implement exactly that rule (space='local' applies
// q·R(e_k,θ) = R(visible axis,θ)·q); the writeback (applyGizmoOrientation →
// rawFromView) is the UNCHANGED v0.150 blueprint path, proven to carry the
// chained pose into the file quaternion bit-true.
// ?gizmatest&shot=1|2|3 leaves the demo scene at before / +pitch90 /
// +pitch90+roll90 for headless screenshots.
async function runGizmoTest() {
  const fails = []; let nPins = 0;
  const ok = (nm, cond) => { nPins++; if (cond !== true)
    fails.push(nm + (typeof cond === 'string' ? ' [' + cond + ']' : '')); };
  try {
    let tw = Date.now();   // let the default load finish (manifest + scene) first
    while (!H.model && Date.now() - tw < 10000) await new Promise(r => setTimeout(r, 100));
    if (!H.model) { document.title = 'GIZMATEST ERR no baseline'; return; }
    // one-component blueprint; data.colors PRESENT so LEGACY_Q=false
    const seatBp = () => ({ version: 2, mass: 40, type: 'Archean Build Blueprint',
      author: 'gizmatest', datetime: '2026-10-09 00:00:00', workshop_item_id: 9000000002,
      box_min: { x: -0.4, y: 0, z: -0.4 }, box_max: { x: 0.4, y: 0.9, z: 0.4 },
      box_size: { x: 0.8, y: 0.9, z: 0.8 },
      data: { alias: 'gizmatest seat', colors: [
          { r: 200, g: 200, b: 200, opacity: 15, roughness: 0, metallic: 0 },
          { r: 90, g: 90, b: 90, opacity: 15, roughness: 0, metallic: 0 }],
        components: [{ type: 'PilotSeat', module: 'ARCHEAN_pilot_seat',
          position: { x: 0, y: 0, z: 0 }, frame_x: 0, frame_y: 0, frame_z: 0,
          orientation: { w: 1, x: 0, y: 0, z: 0 },
          colors: { color1: 0, color2: 1 }, data: {}, occupancies: [] }],
        blocks: [], triangles: [], pipes: [] } });
    const aimCamera = () => { H.camera.position.set(0, 0.55, 2.6);
      H.controls.target.set(0, 0.3, 0); H.camera.lookAt(H.controls.target);
      H.controls.update(); H.invalidate(); };
    if (!H.realModelsOn) H.setRealModels(true);      // a recognizable seat for shots
    H.setModel(seatBp(), 'gizmatest seat');
    H.select(0);
    aimCamera();

    // ---- A. the pure contract, generic (UI-free) pose ----
    const D90 = Math.PI / 2, TH = 1.0;
    const q0 = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.28, 0.7, -0.15, 'YXZ'));
    const qAx = (a, t) => new THREE.Quaternion().setFromAxisAngle(a.clone().normalize(), t);
    for (const k of ['x', 'y', 'z']) {          // each ring spins about ITS axis
      const q1 = H.gizmoSpinRing(q0, k, TH), a = H.gizmoCol(q0, k);
      const others = ['x', 'y', 'z'].filter(j => j !== k);
      ok('ring' + k, H.gizmoCol(q1, k).dot(a) > 1 - 1e-6
        && others.every(j => H.gizmoCol(q1, j).dot(
             H.gizmoCol(q0, j).applyQuaternion(qAx(a, TH))) > 0.9999));
    }
    // WYSIWYG identity: intrinsic == world premultiply about the VISIBLE axis
    ok('equiv', Math.abs(H.gizmoSpinRing(q0, 'x', TH)
      .dot(qAx(H.gizmoCol(q0, 'x'), TH).multiply(q0).clone())) > 0.9999);
    // the user's case: pitch 90° THEN roll 90° — order matters, and the second
    // step spins about the ring's axis as MOVED BY the first step
    const qP = H.gizmoSpinRing(q0, 'x', D90), qPR = H.gizmoSpinRing(qP, 'y', D90);
    const qRP = H.gizmoSpinRing(H.gizmoSpinRing(q0, 'y', D90), 'x', D90);
    ok('noncommute', 1 - Math.abs(qPR.dot(qRP)) > 0.2);
    // world-frame view of the same chain: forward vector a-turns about the
    // visible X ring, THEN turns about the (moved) visible Y ring
    const za = H.gizmoCol(q0, 'z').applyQuaternion(qAx(H.gizmoCol(q0, 'x'), D90));
    const zb = za.applyQuaternion(qAx(H.gizmoCol(qP, 'y'), D90));
    ok('chain', H.gizmoCol(qPR, 'z').dot(zb) > 0.9999);
    // trackball: extrinsic spin about the camera eye axis
    const eye = new THREE.Vector3(0.3, 0.4, 1);
    ok('eye', Math.abs(H.gizmoSpinEye(q0, eye, TH)
      .dot(qAx(eye, TH).multiply(q0).clone())) > 0.9999);
    // shipped configuration = the rule the model describes
    ok('config', H.tctl.mode === 'rotate' && H.tctl.space === 'local');
    // v0.156 knob continuity: TransformControls reports the ring drag as a
    // raw atan2 angle in (−π, π] — sweeping a knob past 180° pops it back
    // toward the start pose (user report). The shipped writeback unwraps:
    // per-event wrapped deltas accumulate into a continuous spin, both ways.
    { const a1 = H.gizmoUnwrap(3.10, 3.08, 3.08);
      const a2 = H.gizmoUnwrap(-3.10, 3.10, a1);          // crossing +π keeps going
      const b2 = H.gizmoUnwrap(3.08, 3.10, a1);           // reversing follows down
      ok('unwrap', a1 > 3.099 && a1 < 3.101 && a2 > 3.14 && a2 < 3.25
         && Math.abs(b2 - 3.08) < 1e-9); }
    // v0.153 mode switch: move mode engages the same proxy; the position
    // writeback is the raw/mirror involution (view z-flip undoes itself).
    // v0.158: move mode is WORLD-space (arrows stay axis-aligned), only the
    // rotate rings are part-axis local (user: "the move gizmo rotates and
    // becomes non axis aligned, that's bad").
    H.setGizmoMode('move');
    const tcMove = H.tctl.mode === 'translate' && H.tctl.space === 'world';
    H.setGizmoMode('rotate');
    ok('movecfg', tcMove && H.tctl.mode === 'rotate' && H.tctl.space === 'local'
      && localStorage.getItem('archean-gizmo-mode') === 'rotate');
    { const raw = { x: 1.1, y: -2.3, z: 0.7 }, v = H.viewPos(raw);
      ok('moveinv', Math.abs(v.x - raw.x) < 1e-12 && Math.abs(v.y - raw.y) < 1e-12
        && Math.abs(-v.z - raw.z) < 1e-12); }

    // ---- B. scene proof through the REAL writeback path ----
    const obj = H.compObjs[0], comp = H.model.data.components[0];
    H.scene.updateMatrixWorld(true);
    const qv0 = obj.getWorldQuaternion(new THREE.Quaternion());   // stripped frame = qv·RY180
    const projN = (q) => { const p = new THREE.Vector3(0, 0, 1)   // proxy +z = part raw −z = nose
        .applyQuaternion(q).add(H.camera.position).project(H.camera); return [p.x, p.y]; };
    const qv1 = H.gizmoSpinRing(H.gizmoSpinRing(qv0, 'x', D90), 'y', D90);   // proxy-frame chain
    const n0 = projN(qv0);
    H.applyGizmoOrientation(qv1);
    H.scene.updateMatrixWorld(true);
    ok('file', Math.abs(H.viewQuat(comp.orientation)
      .dot(qv1.clone().multiply(H.GIZMO_Y180))) > 0.9999);          // mesh qv = P·RY180
    ok('live', Math.abs(obj.getWorldQuaternion(new THREE.Quaternion())
      .dot(qv1)) > 0.9999);                                       // decompose tracks the rings
    const n1 = projN(qv1);
    ok('nose', Math.hypot(n1[0] - n0[0], n1[1] - n0[1]) > 0.4);  // swung visibly on screen
    ok('proxy', Math.abs(H.gizmoProxy.quaternion.dot(qv1)) > 0.9999);  // rings track the part

    // ---- B2. widget ORIENTATION proof (v0.158, user: "translation widget
    // rotates"): swing the proxy 40° about z and MEASURE the rendered widget
    // nodes — the translate ARROWS must not move a degree (world space), the
    // rotate RINGS must follow exactly (local space).
    { const tRoot = H.tctl.getHelper();
      const G = tRoot.children.find(o => o.isTransformControlsGizmo);
      const wq = (mode) => {
        const x = G.gizmo[mode].children.find(c => c.name === 'X');
        tRoot.updateMatrixWorld(true);
        return x.getWorldQuaternion(new THREE.Quaternion());
      };
      H.setGizmoMode('move'); H.gizmoProxy.quaternion.identity();
      const aMove = wq('translate');
      H.gizmoProxy.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 40 * Math.PI / 180);
      const bMove = wq('translate');
      const dArrow = aMove.angleTo(bMove);                       // must be ~0
      H.setGizmoMode('rotate'); H.gizmoProxy.quaternion.identity();
      const aRot = wq('rotate');
      H.gizmoProxy.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 40 * Math.PI / 180);
      const dRing = aRot.angleTo(wq('rotate'));                  // must be ~40°
      H.gizmoProxy.quaternion.copy(qv1);
      ok('movespace', (dArrow < 1e-6 && dRing > 0.69 && dRing < 0.71)
        || `arrowΔ=${dArrow.toFixed(4)} ringΔ=${dRing.toFixed(4)} (want ~0 / ~0.698)`); }

    // ---- B3. ring hover style (v0.160→162): the ACTIVE ring thickens and
    // nothing turns yellow (user: "the wrong axis rotater becomes yellow and
    // thick, KEEP THE COLOR") — TGC's highlight writes SHARED materials
    // (hit-torus + full-track rings), so the pin simulates TGC's exact
    // material writes and asserts the per-frame restore undoes them ----
    { const G = H.tctl.getHelper().children.find(o => o.isTransformControlsGizmo);
      const ring = (nm) => G.gizmo.rotate.children.find(m => m.isMesh && m.name === nm
        && m.userData.ringThin);
      const x = ring('X'), y = ring('Y');
      const hitMeshes = [];
      G.children.forEach(o => o.traverse(m => {
        // the shared hit-material signature (v0.162 probe): _opacity 0.15,
        // colour white — ONE material instance across every axis's pick mesh
        if (m.isMesh && m.material._opacity === 0.15) hitMeshes.push(m);
      }));
      const hit = hitMeshes[0];
      const trk = G.gizmo.rotate.children.find(m => m.isMesh
        && m.material._opacity > 0.01 && m.material._opacity < 1);
      H.tctl.axis = 'X'; H.paintHighlights();
      const fatX = x.geometry === x.userData.ringFat;
      const thinY = y.geometry === y.userData.ringThin;
      const gold = !!x.material._color && x.material.color.getHex() !== 0xffff00;
      let noFlash = 'no hit-mesh';
      if (hit) {
        hit.material.color.setHex(0xffff00); hit.material.opacity = 1;  // TGC write
        if (trk) trk.material.opacity = 1;
        H.paintHighlights();
        noFlash = hit.material.opacity === hit.material._opacity
          && hit.material.color.getHex() !== 0xffff00
          && (!trk || trk.material.opacity
               === (trk.userData.trackHide ? 0 : trk.material._opacity));
      }
      H.tctl.axis = null; H.paintHighlights();
      const backThin = x.geometry === x.userData.ringThin;
      // v0.163: the axis-less trackball rings (E/XYZE) stay hidden
      const trackHid = G.gizmo.rotate.children
        .filter(m => m.userData.trackHide)
        .every(m => m.material.opacity === 0);
      ok('gizmostyle', (fatX && thinY && gold && backThin && noFlash === true
                         && trackHid)
        || `fatX=${fatX} thinY=${thinY} noYellow=${gold} back=${backThin}`
        + ` flash=${noFlash} track=${trackHid}`); }

    // ---- B3b. v0.164/165 (user: "they dont light up for the entire
    // thing; make the thicker selected version match location of the
    // normal handles"): the FATTENED hover state covers the WHOLE handle
    // — EVERY visible mesh of the hovered axis — and COINCIDES with the
    // normal one: verified on real geometry bounding boxes (same local
    // bbox CENTER = the fat variant is a clone fattened IN PLACE, r169
    // bakes every mesh transform into geometry, so fat variants MUST
    // clone (the v0.164 raw-reconstruction fat variants sat at the raw
    // canonical pose: arrows shifted h/2, rings in a neighbour plane)
    // and be strictly fatter. ----
    { const G = H.tctl.getHelper().children.find(o => o.isTransformControlsGizmo);
      const allX = G.gizmo.translate.children.filter(m => m.isMesh
        && m.name === 'X' && m.userData.thickable);
      const thin0 = allX.map(m => m.geometry);
      thin0.forEach(g => g.computeBoundingBox());
      H.setGizmoMode('move'); H.tctl.axis = 'X'; H.paintHighlights();
      const fatAll = allX.every(m => m.geometry === m.userData.ringFat);
      const coincide = allX.every((m, k) => {
        const a = m.geometry.boundingBox
          ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox);
        const b = thin0[k].boundingBox;
        const c = (bb, ax) => (bb.max[ax] + bb.min[ax]) / 2;
        const szA = a.max.x - a.min.x + (a.max.y - a.min.y)
          + (a.max.z - a.min.z);
        const szB = b.max.x - b.min.x + (b.max.y - b.min.y)
          + (b.max.z - b.min.z);
        return Math.abs(c(a, 'x') - c(b, 'x')) < 1e-6
          && Math.abs(c(a, 'y') - c(b, 'y')) < 1e-6
          && Math.abs(c(a, 'z') - c(b, 'z')) < 1e-6
          && szA > szB + 1e-3; });
      H.tctl.axis = null; H.paintHighlights();
      const backAll = allX.every((m, k) => m.geometry === thin0[k]);
      H.setGizmoMode('rotate'); H.paintHighlights();
      ok('gizmofat', (allX.length >= 2 && fatAll && coincide && backAll)
        || `n=${allX.length} fat=${fatAll} coincide=${coincide} back=${backAll}`); }

    // ---- B4. REAL hover path (v0.163, user: "when I hover over the blue
    // axes it lights up yellow WRONG; a large yellow circle around it that
    // I dont know which angle it is; and then I select, it is in a
    // different spot"): a synthetic canvas pointermove drives TGC's own
    // pointerHover (picker raycast). Pinned: (1) the ring's PICKER wins
    // (axis='Z', not the trackball's 'E' — the v0.162 bug: the E pick
    // torus r0.75 t0.1 occluded every ring), (2) hover dispatches
    // 'change' (invalidate), (3) TGC's RAW updateMatrixWorld flashes the
    // hovered axis's handles yellow — and the SHIPPED chain (our override:
    // TGC update → styleGizmo restore) clears it in the same pass, before
    // the frame draws, (4) the intended ring fattens, (5) the axis-less
    // E/XYZE visible rings stay hidden, (6) the gizmo sits at the part's
    // bbox CENTRE (the 'different spot' complaint).
    { const cv = H.renderer.domElement, rect = cv.getBoundingClientRect();
      H.setGizmoMode('rotate'); H.syncGizmo();
      const atCentre = H.gizmoProxy.position.distanceTo(
        new THREE.Box3().setFromObject(H.compObjs[0]).getCenter(new THREE.Vector3()))
        < 1e-6;
      const G2 = H.tctl.getHelper().children.find(o => o.isTransformControlsGizmo);
      const scanY = () => { let y = false;
        H.tctl.getHelper().traverse(m => {
          if (m.isMesh && m.material._color && m.material._color.getHex() !== 0xffff00
              && m.material.color.getHex() === 0xffff00) y = true; });
        return y; };
      // aim ON THE VISIBLE Z RING'S CENTRELINE mid-arc AWAY FROM THE
      // CROSSINGS — in the RING MESH's local frame (TGC's handle scaling
      // shrinks the world ring to r·0.52; the proxy-local r 0.5 aim point
      // lands at 1.9× the ring, which is what made this pin aim-miss).
      H.scene.updateMatrixWorld(true);
      const p = H.rayRingVis.Z.localToWorld(new THREE.Vector3(0.3536, -0.3536, 0));
      p.project(H.camera);
      H.needsRender = false;
      cv.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1, pointerType: 'mouse', bubbles: true,
        clientX: rect.left + (p.x + 1) / 2 * rect.width,
        clientY: rect.top - (p.y - 1) / 2 * rect.height }));
      const ringPicked = H.tctl.axis === 'Z';
      const woke = H.needsRender === true;
      Object.getPrototypeOf(G2).updateMatrixWorld.call(G2, true);  // RAW TGC flash
      const rawYellow = scanY();
      H.scene.updateMatrixWorld(true);                               // shipped chain
      const cleared = !scanY();
      const arc = G2.gizmo.rotate.children.find(m => m.isMesh && m.name === 'Z'
        && m.userData.thickable);
      const fat = arc.geometry === arc.userData.ringFat;
      // v0.165: the fat variant fattens IN PLACE (clone-and-radial-fatten
      // of the BAKED geometry): the Y ring (XZ plane) must keep its thin
      // tube extent on its normal axis (y) far below the ring radius —
      // an un-baked reconstruction would sit in the XY plane (y ≈ r).
      const arcY = G2.gizmo.rotate.children.find(m => m.isMesh
        && m.name === 'Y' && m.userData.thickable);
      const gF = arcY.userData.ringFat, gT = arcY.userData.ringThin;
      gF.computeBoundingBox(); gT.computeBoundingBox();
      const baked = gF.boundingBox.max.y < 0.1
        && gF.boundingBox.max.x > gT.boundingBox.max.x;
      const track = G2.gizmo.rotate.children.filter(m => m.userData.trackHide)
        .every(m => m.material.opacity === 0);
      ok('gizmohover', (atCentre && ringPicked && woke && rawYellow && cleared
        && fat && baked && track)
        || `centre=${atCentre} axis=${H.tctl.axis} woke=${woke} raw=${rawYellow}`
        + ` cleared=${cleared} fat=${fat} baked=${baked} track=${track}`);
      H.tctl.axis = null; H.scene.updateMatrixWorld(true); }

    // ---- C. demo state for screenshots (before / +pitch / +pitch+roll) ----
    H.setModel(seatBp(), 'gizmatest seat');
    H.select(0);
    aimCamera();
    H.scene.updateMatrixWorld(true);
    const qv = H.compObjs[0].getWorldQuaternion(new THREE.Quaternion());
    const step = H.gizmoShot === 4 ? 0
      : Math.min(2, Math.max(0, (H.gizmoShot | 0) - 1));
    const demoQ = [qv, H.gizmoSpinRing(qv, 'x', D90),
                   H.gizmoSpinRing(H.gizmoSpinRing(qv, 'x', D90), 'y', D90)][step];
    if (step > 0) H.applyGizmoOrientation(demoQ);
    if (H.gizmoShot === 4) {      // v0.165 WYSIWYG: RING-HOVER state — the
      H.setGizmoMode('rotate'); H.syncGizmo();   // aimed Z ring fattens IN PLACE
      H.scene.updateMatrixWorld(true);
      const cv4 = H.renderer.domElement, rect4 = cv4.getBoundingClientRect();
      const p4 = H.rayRingVis.Z.localToWorld(new THREE.Vector3(0.3536, -0.3536, 0));
      p4.project(H.camera);
      cv4.dispatchEvent(new PointerEvent('pointermove', {
        pointerId: 1, pointerType: 'mouse', bubbles: true,
        clientX: rect4.left + (p4.x + 1) / 2 * rect4.width,
        clientY: rect4.top - (p4.y - 1) / 2 * rect4.height }));
      H.scene.updateMatrixWorld(true);
    }
    H.invalidate();
    document.title = fails.length ? 'GIZMATEST FAIL ' + fails.join(',')
                                  : `GIZMATEST PASS n=${nPins}`;
  } catch (e) {
    document.title = 'GIZMATEST ERR ' + e.message + ' @'
      + String(e.stack).split(String.fromCharCode(10))[1].trim().slice(0, 70);
  }
}

// ---------- UI sweep (?uitest) ----------
// Headless click-through of the whole panel: every checkbox/button/slider/⟲
// the user can touch gets driven through its REAL handler, plus behaviours
// the pure-state pins cannot reach (filter, list click, keyboard shortcuts,
// checkbox↔group sync, dirty-flag lifecycle, preset buttons). Failing pins
// land in the title; captured window errors go to #out.
async function runUiTest() {
  const fails = [], errs = [];
  const collect = (e) => errs.push(String((e && (e.message || e.reason)) || e));
  addEventListener('error', collect);
  addEventListener('unhandledrejection', collect);
  let nPins = 0;   // counted dynamically: the title can never desync the pins
  const ok = (nm, cond) => { nPins++; if (cond !== true)
    fails.push(nm + (typeof cond === 'string' ? ' [' + cond + ']' : '')); };
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const setIn = (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const btn = (root, t) => [...root.querySelectorAll('button')].find(b => b.textContent.includes(t));
  const numRow = (root, label) => [...root.querySelectorAll('.row')]
    .find(r => r.querySelector('label')?.textContent === label)?.querySelector('input[type=number]');
  const cbL = (t) => [...document.querySelectorAll('#panel input[type=checkbox]')]
    .find(c => (c.parentElement.textContent || '').includes(t));
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const settle = async (pred, ms = 4000) => { const t0 = Date.now();
    while (!pred() && Date.now() - t0 < ms) await sleep(50); return pred(); };

  // filter: typing narrows the list to matching types; clearing restores it
  // (grouped list v0.157: rows live inside .grp containers; search force-opens)
  { const tot = H.model.data.components.length;
    const rows = () => [...H.$('complist').querySelectorAll('.grp > div[data-idx]')];
    setIn(H.$('filter'), 'wheel');
    const r0 = rows();
    const only = r0.length > 0 && r0.every(d => d.textContent.includes('Wheel'));
    setIn(H.$('filter'), '');
    ok('filter', only && rows().length === tot); }

  // list tabs (v0.156): by-type sections vs by-subgrid (Build sections +
  // hull-parts section); every flat part is listed in both; the choice persists
  { const tot = H.model.data.components.length;
    const rows = () => [...H.$('complist').querySelectorAll('.grp > div[data-idx]')];
    const secs = () => [...H.$('complist').querySelectorAll('.sec')];
    const [tbType, tbSub] = [...H.$('ltabs').children];
    tbType.click();
    const typeOk = rows().length === tot && secs().length > 1;
    tbSub.click();
    const subOk = rows().length === tot && secs().some(d => d.textContent.includes('no subgrid'));
    tbType.click();
    ok('listtabs', typeOk && subOk && H.listTab === 'type'
       && localStorage.getItem('archean-list-tab') === 'type'); }

  // collapsible groups (v0.157): groups are collapsed by default, header
  // toggles, and SELECTING a part auto-expands its group (listclick pin).
  // Self-contained: force every group closed via its own header first, so
  // earlier pins' open-states cannot skew the baseline.
  { const list = H.$('complist');
    const grps = () => [...list.querySelectorAll('.grp')];
    for (const h of list.querySelectorAll('.sec'))
      if (h.nextElementSibling.style.display !== 'none') h.click();
    const allCol = grps().length > 1 && grps().every(g => g.style.display === 'none');
    list.querySelector('.sec').click();
    const opened = grps()[0].style.display !== 'none';
    list.querySelector('.sec').click();
    const reclosed = grps()[0].style.display === 'none';
    ok('listcollapse', (allCol && opened && reclosed)
      || `n=${grps().length} allCol=${allCol} opened=${opened} reclosed=${reclosed}`); }

  // list click: a row selects — header names it and the inspector builds;
  // v0.157: selecting AUTO-EXPANDS the containing group (reveal)
  { const d0 = H.$('complist').querySelectorAll('.grp > div[data-idx]')[3];
    const idx = +d0.dataset.idx;
    click(d0);
    const d = H.$('complist').querySelector(`.grp > div[data-idx="${idx}"]`);
    const msg = `sel=${H.selected} want ${idx} row=${!!d}`
      + ` grp=${d ? d.closest('.grp')?.style.display || 'open' : '-'} name=${H.$('selname').textContent}`
      + ` rows=${H.$('inspector').querySelectorAll('.row').length}`;
    ok('listclick', (H.selected === idx && d && d.closest('.grp').style.display !== 'none'
       && H.$('selname').textContent.includes(H.model.data.components[idx].type)
       && H.$('inspector').querySelectorAll('.row').length >= 6) || msg); }

  // rotate gizmo attaches on selection — to the scene-root PROXY, never the
  // mirrored mesh (attaching under worldM would mirror Y/Z drags, see gizmo
  // section); toggling the checkbox detaches/reattaches
  { ok('gizmo', H.selected >= 0 && H.tctl.object === H.gizmoProxy
      && H.tctl.getHelper().parent === H.scene);
    const gcb = cbL('rotate gizmo');
    click(gcb);
    const off = H.tctl.object == null;
    click(gcb);
    ok('gizmo2', off && H.tctl.object === H.gizmoProxy); }

  // number edit moves RAW data; the row ⟲ restores it
  { const si = H.model.data.components.findIndex(c => c.type === 'PilotSeat');
    H.select(si);
    const comp = H.model.data.components[si], x0 = comp.position.x;
    const nx = numRow(H.$('inspector'), 'x');
    setIn(nx, x0 + 0.375);
    const moved = Math.abs(comp.position.x - (x0 + 0.375)) < 1e-9 && document.body.classList.contains('dirty');
    click(nx.parentElement.querySelector('.rst'));
    ok('editreset', moved && Math.abs(comp.position.x - x0) < 1e-12);

    // (v0.156: the nose/tail/up nudge presets were REMOVED as meaningless —
    //  the position sliders + gizmo cover it; the seat lean presets below keep
    //  the preset-button code path pinned)

    // Actions-reset returns position to the file state
    click([...H.$('inspector').querySelectorAll('button')].find(b => b.textContent.includes('reset this component')));
    ok('compreset', ['x', 'y', 'z'].every(k => Math.abs(comp.position[k] - H.orig[si].pos0[k]) < 1e-12));

    // PilotSeat lean preset bends the seat from its just-reset pose
    const qb = H.compObjs[si].quaternion.clone();
    click(btn(H.$('inspector'), 'lean fwd 12°'));
    ok('seatpreset', H.compObjs[si].quaternion.angleTo(qb) > 0.15);   // ≥12° applied
    H.select(-1); }

  // ⟲ must RE-PAINT (v0.149 user: "resetting a component doesnt immediatley
  // reset it, it changes sliders but no visual update is triggered"):
  // set() assigns .value programmatically — no 'input' event — and the click
  // itself scheduled no redraw, so the picture lagged the data
  { const si = H.model.data.components.findIndex(c => c.type === 'PilotSeat');
    H.select(si);
    const nx = numRow(H.$('inspector'), 'x');
    setIn(nx, +nx.value + 0.25);
    const s0 = H.invalSeq;
    click(nx.parentElement.querySelector('.rst'));
    ok('resetpaint', H.invalSeq > s0
      && Math.abs(H.model.data.components[si].position.x - (+nx.value + 0.25 - 0.25)) < 1e-9);
    H.select(-1); }

  // component-data checkbox writes through to comp.data
  { const di = H.model.data.components.findIndex(c => c.data
      && Object.values(c.data).some(v => typeof v === 'boolean'));
    let pass = false;
    if (di >= 0) {
      H.select(di);
      const cb = H.$('inspector').querySelector('.checkrow input[type=checkbox]');
      const d0 = H.model.data.components[di].data;
      const k = Object.keys(d0).find(k => typeof d0[k] === 'boolean');
      if (cb) { const before = d0[k]; click(cb);
        pass = d0[k] === !before; click(cb); pass = pass && d0[k] === before; }
      H.select(-1);
    }
    ok('dataedit', pass); }

  // keys g/o/h flip groups AND stay synced with their checkboxes; 'h' moves
  // blocks+triangles together (ONE hull); Esc deselects
  { H.select(H.model.data.components.findIndex(c => c.type === 'PilotSeat'));
    const keyd = (k) => dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    let pass = true;
    for (const [k, tk, groups] of [['g', 'grid', [H.grid]], ['o', 'occ', [H.occGroup]],
                                   ['h', 'hull', [H.blockGroup, H.hullGroup]]]) {
      const t = H.viewToggles[tk], v0 = groups.every(o => o.visible);
      keyd(k);
      if (!(groups.every(o => o.visible) === !v0 && t.cb.checked === !v0)) pass = false;
      keyd(k);
      if (!(groups.every(o => o.visible) === v0 && t.cb.checked === v0)) pass = false;
    }
    keyd('Escape');
    ok('keys', pass && H.selected === -1); }

  // real-models checkbox swaps proxies<->real geometry AND persists
  { const cb = cbL('real game models');
    if (!cb.checked) click(cb);
    const on = await settle(() => H.realModelsOn && H.realMap.size > 0);
    // "⟲ reset this component" must move proxy AND real siblings + repaint +
    // write a PLAIN numeric file quaternion (v0.152 user: "resetting the
    // component still doesnt update it in the 3d view" — no invalidate on
    // button paths, real groups (siblings, not children) stayed put, and
    // {...q0} spread THREE _x/_y accessor fields into comp.orientation)
    let cres = true;
    {
      const si = H.model.data.components.findIndex(c => c.type === 'PilotSeat');
      H.select(si);
      const obj = H.compObjs[si], nx = numRow(H.$('inspector'), 'x');
      const x0 = obj.position.x;
      setIn(nx, +nx.value + 0.3);
      const s0 = H.invalSeq;
      click([...H.$('inspector').querySelectorAll('button')]
        .find(b => b.textContent.includes('reset this component')));
      cres = H.invalSeq > s0 && Math.abs(obj.position.x - x0) < 1e-9
        && Math.abs(H.model.data.components[si].position.x - H.orig[si].pos0.x) < 1e-9
        && ['w', 'x', 'y', 'z'].every(k => Number.isFinite(H.model.data.components[si].orientation[k]))
        && (H.realMap.get(si) || []).every(r => r.position.x === obj.position.x);
      H.select(-1);
    }
    click(cb);
    const off = await settle(() => !H.realModelsOn && H.realMap.size === 0);
    ok('realmodels', on && off && localStorage.getItem('archean-real-models-v2') === '0');
    ok('compreset', cres); }

  // mode widget (v0.153): a canvas click pops ⊘/✥/⟳/ℹ at the click point;
  // the buttons drive the gizmo and persist
  { const si = H.compObjs.findIndex(o => !!o);
    const v = new THREE.Vector3(); H.compObjs[si].getWorldPosition(v); v.project(H.camera);
    const r = H.renderer.domElement.getBoundingClientRect();
    const cx = r.left + (v.x * .5 + .5) * r.width, cy = r.top + (-v.y * .5 + .5) * r.height;
    const ev = (t) => H.renderer.domElement.dispatchEvent(new PointerEvent(t,
      { clientX: cx, clientY: cy, bubbles: true, pointerId: 1, isPrimary: true }));
    const prev = H.selected;
    ev('pointerdown'); ev('pointerup');
    const vis = H.modeBox.classList.contains('vis') && H.selected === si;
    // v0.156: the widget is projection-tied to the PART, not the click pixel
    const tied = H.modeAnchor === H.compObjs[si]
      && Math.abs(parseFloat(H.modeBox.style.left) - Math.min(cx + 10, innerWidth - 118)) < 160
      && Math.abs(parseFloat(H.modeBox.style.top) - Math.min(cy + 8, innerHeight - 44)) < 160;
    H.modeBox.querySelector('[data-m="move"]').click();
    const mv = H.gizmoMode === 'move' && H.tctl.mode === 'translate'
      && H.tctl.object === H.gizmoProxy && localStorage.getItem('archean-gizmo-mode') === 'move';
    H.modeBox.querySelector('[data-m="none"]').click();
    const nv = H.tctl.object == null;
    H.modeBox.querySelector('[data-m="rotate"]').click();
    const rb = H.tctl.mode === 'rotate' && H.tctl.object === H.gizmoProxy;
    H.hideModeBox(); H.select(prev, false);
    ok('modebox', vis && tied && mv && nv && rb); }

  // ⇄ mirror button (v0.161): the widget's fifth button toggles twin-move
  // propagation (persisted archean-sym), and its strikethrough state tracks
  // the EFFECTIVE switch (off-clicked or auto-off pair) for the selection
  { const sb = H.modeBox.querySelector('[data-m="sym"]');
    const ent = [...H.symTwinIndex().entries()].find(([, ts]) => ts.length);
    if (!sb || !ent) ok('symwidget', 'no twin pair on this craft');
    else {
      const prev = H.selected;
      H.select(ent[0], false);
      const on0 = H.symOn;
      sb.click();
      const s1 = { on: H.symOn, ls: localStorage.getItem('archean-sym'),
                   off: sb.classList.contains('off') };
      sb.click();
      const s2 = sb.classList.contains('off');   // back ON, pair aligned → no strike
      H.select(prev, false);
      ok('symwidget', s1.on === !on0 && s1.off === !s1.on
        && s1.ls === (s1.on ? '1' : '0') && H.symOn === on0 && s2 === false);
    } }

  // SLIDER edits ride the mirror too (v0.162, user: "mirror is not
  // respected; I edited one wheel, it didnt do the other")
  { const ent = [...H.symTwinIndex().entries()].find(([, ts]) => ts.length);
    const [si, [[ti]]] = ent;
    H.select(si, false);
    const sl = [...document.querySelectorAll('#inspector .row')]
      .find(r => r.querySelector('label')?.textContent === 'x')
      ?.querySelector('input[type=range]');
    const x0 = H.model.data.components[si].position.x, t0 = H.model.data.components[ti].position.x;
    setIn(sl, x0 + 0.25);
    const okS = Math.abs(H.model.data.components[si].position.x - (x0 + 0.25)) < 1e-9
      && Math.abs(H.model.data.components[ti].position.x - (t0 - 0.25)) < 1e-9
      && Math.abs(H.compObjs[ti].position.x - (t0 - 0.25)) < 1e-9;
    setIn(sl, x0);                                // reverse edit propagates
    ok('symslider', okS
      && Math.abs(H.model.data.components[ti].position.x - t0) < 1e-9
      && Math.abs(H.compObjs[ti].position.x - t0) < 1e-9); }

  // ROTATION sliders ride the mirror too (v0.165, user: "manipulation of
  // its rotation does NOT affect the counterpart"): yawing the selected
  // ISW aileron +15° (about ŷ) via the inspector slider must spin the
  // twin's MESH by the MIRRORED delta Ry(−15°) — SIGN-sensitive: mirror
  // conjugation preserves roll (about x̂, the mirror normal) and flips
  // pitch-style spins about ŷ/ẑ — and follow its file quaternion; the
  // reverse edit restores the pair.
  { const ent = [...H.symTwinIndex().entries()].find(([i, ts]) => ts.length
      && H.model.data.components[i].type === 'Aileron');
    if (!ent) ok('symrot', 'no aileron pair on this craft');
    else {
      const [si, [[ti]]] = ent;
      H.select(si, false);
      const q0 = H.compObjs[ti].quaternion.clone();
      const rl = [...document.querySelectorAll('#inspector .row')]
        .find(r => r.querySelector('label')?.textContent === 'yaw')
        ?.querySelector('input[type=range]');
      if (!rl) ok('symrot', 'no yaw slider');
      else {
        setIn(rl, 15);
        const dj = H.compObjs[ti].quaternion.clone().multiply(q0.clone().invert());
        const okR = dj.y < -0.12 && dj.y > -0.14        // sin(−7.5°) ≈ −0.1305
          && Math.abs(dj.x) < 1e-9 && Math.abs(dj.z) < 1e-9;
        setIn(rl, 0);
        const q1 = H.compObjs[ti].quaternion.clone();
        // v0.166: the RED slider (pitch = view x̂ = the mirror NORMAL
        // axis) is PRESERVED on the twin (rolling one wheel back rolls
        // its twin back — the v0.165 code flipped it).
        const pl = [...document.querySelectorAll('#inspector .row')]
          .find(r => r.querySelector('label')?.textContent === 'pitch')
          ?.querySelector('input[type=range]');
        if (!pl) ok('symrot', 'no pitch slider');
        else {
          setIn(pl, 15);
          const dp = H.compObjs[ti].quaternion.clone().multiply(q1.clone().invert());
          const okP = dp.x > 0.12 && dp.x < 0.14        // sin(+7.5°) ≈ +0.1305
            && Math.abs(dp.y) < 1e-9 && Math.abs(dp.z) < 1e-9;
          setIn(pl, 0);
          ok('symrot', okR && okP
            && Math.abs(H.compObjs[ti].quaternion.dot(q1)) > 1 - 1e-9
            && Math.abs(dj.y) > 0.1 && Math.abs(dp.x) > 0.1);
        }
      }
    } }

  // v0.167 (user: "the pivot locations dont seem to be properly
  // positioned, causing parts to rotate/orbit around the wrong
  // position"): with REAL models on, the game geometry renders offset
  // from the part origin (Beacon mast, MiniComputer geometry 3 m off) —
  // the gizmo pivot is now the VISIBLE geometry's centre (proxy ∪ real
  // bbox), and a gizmo spin must ORBIT that centre: the part origin
  // keeps a constant distance from it (the old pure-origin bug left
  // the position frozen while the geometry swung on a lever arm).
  { const bi = H.model.data.components.findIndex(c => c.type === 'Beacon');
    const r0 = H.realModelsOn;
    if (bi < 0) ok('pivotreal', 'no Beacon on this craft');
    else {
      H.setRealModels(true);
      const loaded = await settle(() => (H.realMap.get(bi) || []).length > 0
        && (() => { const b = new THREE.Box3();
          for (const g of H.realMap.get(bi) || []) b.expandByObject(g);
          return isFinite(b.min.x)
            && b.getSize(new THREE.Vector3()).lengthSq() > 0.01; })());
      if (!loaded) ok('pivotreal', 'real Beacon geometry never loaded');
      else {
        H.select(bi, false);
        H.scene.updateMatrixWorld(true);
        const o = H.compObjs[bi];
        const c = H.gizmoCentre(bi);
        const off = c.clone().sub(o.position).length();
        H.gizPivotL = c.clone(); H.symRotPiv.clear();
        const q0 = o.quaternion.clone(), p0 = o.position.clone();
        const qv1 = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.4)
          .multiply(q0).multiply(H.GIZMO_Y180);
        H.applyGizmoOrientation(qv1);
        const dq = o.quaternion.clone().multiply(q0.clone().invert());
        const okQ = Math.abs(dq.x) > 0.1 && Math.abs(dq.y) < 1e-9
          && Math.abs(dq.z) < 1e-9;
        const okR = Math.abs(o.position.distanceTo(c) - p0.distanceTo(c)) < 1e-9
          && p0.distanceTo(o.position) > 0.3 * off;   // a real lever swing
        const pf = H.model.data.components[bi].position;
        const okF = Math.abs(pf.x - o.position.x) < 1e-12
          && Math.abs(pf.y - o.position.y) < 1e-12
          && Math.abs(pf.z + o.position.z) < 1e-12;
        const qv2 = new THREE.Quaternion()
          .setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.4)
          .multiply(o.quaternion.clone()).multiply(H.GIZMO_Y180);
        H.applyGizmoOrientation(qv2);
        const okBack = p0.distanceTo(o.position) < 1e-9
          && Math.abs(o.quaternion.dot(q0)) > 1 - 1e-9;
        H.gizPivotL = null; H.symRotPiv.clear();
        H.select(-1); H.paintHighlights(); H.setRealModels(r0);
        ok('pivotreal', (off > 0.15 && okQ && okR && okF && okBack)
          || `off=${off.toFixed(2)} Q=${okQ} r=${okR} file=${okF} back=${okBack}`);
      }
    } }

  // move gizmo (v0.153): dragging the proxy writes comp.position (RAW),
  // moves mesh + real siblings; occ mirror stays serialize()'s job
  { const si = H.model.data.components.findIndex(c => c.type === 'PilotSeat');
    H.select(si); H.setGizmoMode('move');
    const obj = H.compObjs[si], x0 = H.model.data.components[si].position.x;
    H.scene.updateMatrixWorld(true);
    H.gizmoProxy.position.x += 0.5;
    H.tctl.dispatchEvent({ type: 'objectChange' });
    const moved = Math.abs(H.model.data.components[si].position.x - x0 - 0.5) < 1e-6
      && Math.abs(obj.position.x - (H.gizmoProxy.position.x - H.compGroup.position.x
                                   - H._gizOff.x)) < 1e-6      // centre-anchored (v0.163)
      && (H.realMap.get(si) || []).every(r => Math.abs(r.position.x - obj.position.x) < 1e-9);
    H.gizmoProxy.position.x -= 0.5;              // undo through the same path
    H.tctl.dispatchEvent({ type: 'objectChange' });
    const back = Math.abs(H.model.data.components[si].position.x - x0) < 1e-6;
    H.setGizmoMode('rotate'); H.select(-1);
    ok('movemode', moved && back); }

  // three-way wind buttons switch modes (lines actually built)
  { const f = H.$('flight');
    click(btn(f, 'streamlines'));
    const lines = H.flowMode.m === 'lines' && H.flowGroup.children.some(o => o.isLine && !o.userData.isTrail);
    click(btn(f, 'wind')); const wind = H.flowMode.m === 'wind';
    click(btn(f, 'off'));
    ok('flow', lines && wind && H.flowMode.m === 'off'); }

  // flow-src cycles auto → seat → thrust → auto
  { const fsB = btn(H.$('flight'), 'flow src:'), seq = [];
    for (let i = 0; i < 3; i++) { click(fsB); seq.push(fsB.textContent.replace('flow src: ', '')); }
    ok('flowsrc', seq.join(',') === 'seat,thrust,auto' && H.flowSrc.mode === 'auto'); }

  // CoM/arrows + thrust display buttons flip their groups
  { const com0 = H.aeroArrows.visible, th0 = H.thrustGroup.visible;
    click(btn(H.$('flight'), 'CoM/arrows:'));
    const com = H.aeroArrows.visible === !com0 && H.comMarker.visible === !com0;
    click(btn(H.$('flight'), 'thrust:'));
    ok('flightbtns', com && H.thrustGroup.visible === !th0); }

  // hull-opacity slider dims blocks + skin + wireframes together (the
  // lattice sliders/auto-fit button are gone — exact fit is silent)
  { const nO = numRow(H.$('viewopts'), 'hull opacity');
    setIn(nO, 0.55);
    const bm = H.blockGroup.children.filter(o => o.isMesh);
    ok('hullui', Math.abs(H.hullOpacity - 0.55) < 1e-9 && bm.length > 0
      && bm.every(o => o.material.opacity < 0.5)
      && (!H.blockWireObj || H.blockWireObj.material.opacity < 0.55));
    setIn(nO, 1); }

  // hull-list row click flashes that triangle into the hull group
  { const n0 = H.hullGroup.children.length, row0 = H.$('hulllist').children[0];
    if (row0) { click(row0); ok('hulllist', H.hullGroup.children.length === n0 + 1); }
    else ok('hulllist', false); }

  // header workshop link: real numeric ids point at the Steam page
  { const w = H.$('wslink'), id = String(H.model.workshop_item_id || '');
    ok('wslink', /^\d{6,}$/.test(id) && id !== '0000000000'
      ? w.href.includes('steamcommunity.com') && w.href.includes(id)
      : w.style.display === 'none'); }

  // dirty-flag lifecycle: an edit marks dirty, the Save button clears it
  { const nO = numRow(H.$('viewopts'), 'hull opacity');
    setIn(nO, 0.95);
    const dirtied = document.body.classList.contains('dirty');
    click(H.$('saveBtn'));
    ok('dirty', dirtied && !document.body.classList.contains('dirty'));
    setIn(nO, 1); }

  // zoom-cure button clears the saved dpr baseline without throwing
  { localStorage.setItem('archean-dpr-base', '1');
    click(btn(H.$('viewopts'), 'reset page zoom'));
    ok('zoombtn', localStorage.getItem('archean-dpr-base') === null); }

  // labels checkbox flips labelsOn + label visibility
  { const cb = cbL('labels on interactive'), v0 = H.labelsOn;
    click(cb);
    const vis = H.labelsOn === !v0
      && [...H.compGroup.children].some(o => o.userData.isLabel && o.visible === H.labelsOn);
    click(cb);
    ok('labels', vis && H.labelsOn === v0); }

  // calibrated cell mass reproduces the declared craft total (report ✔)
  { const mm = H.massModel();
    ok('mass', mm.declared > 0 && Math.abs(mm.tot - mm.declared) / mm.declared < 0.02); }

  // SWEEP: EVERY touchable panel control gets its real handler fired
  // (open/save excluded: file pickers + downloads cannot run headless)
  let n = 0;
  { const ctrls = [...document.querySelectorAll('#panel input, #panel button, #panel .rst')]
      .filter(el => !['openBtn', 'saveBtn'].includes(el.id));
    for (const el of ctrls) {
      n++;
      const ty = (el.type || '').toLowerCase();
      try {
        if (el.classList.contains('rst') || el.tagName === 'BUTTON') click(el);
        else if (ty === 'checkbox') click(el);
        else if (ty === 'range') setIn(el, (+el.min + +el.max) / 2);
        else if (ty === 'number') { const v = parseFloat(el.value);
          if (Number.isFinite(v)) setIn(el, v + (+el.step || 1)); }
        else if (ty === 'text') setIn(el, 'uitest');
      } catch (e) { errs.push('ctrl:' + e); }
    }
    let parsed = false;
    try { JSON.parse(H.serialize()); parsed = true; } catch { /* fail below */ }
    ok('sweep', n > 30 && parsed); }

  ok('no-errors', errs.length === 0);

  document.title = fails.length ? 'UITEST FAIL ' + fails.join(',')
                                : `UITEST PASS n=${nPins} ctrls=${n}`;
  if (location.search.includes('wbshot')) {     // dev visual state: widget + move gizmo
    const si = H.compObjs.findIndex(o => !!o);
    if (si >= 0) {
      H.select(si, false); H.setGizmoMode('move');
      const v = new THREE.Vector3(); H.compObjs[si].getWorldPosition(v); v.project(H.camera);
      const r = H.renderer.domElement.getBoundingClientRect();
      H.showModeBox(r.left + (v.x * .5 + .5) * r.width, r.top + (-v.y * .5 + .5) * r.height,
        H.compObjs[si]);
      H.invalidate();
    }
  }
  if (errs.length) {
    const pre = document.createElement('pre'); pre.id = 'out';
    pre.textContent = errs.slice(0, 20).join('\n');
    document.body.appendChild(pre);
  }
}
// ---------- self-test (view3d.html?selftest): simulates slider edits + save ----------
if (location.search.includes('selftest')) {
  setTimeout(async () => {
    try {
      const idx = H.model.data.components.findIndex(c => c.type === 'PilotSeat');
      H.select(idx);
      const comp = H.model.data.components[idx], obj = H.compObjs[idx];
      comp.position.z += 0.25; obj.position.z -= 0.25;                       // like the z slider (raw +0.25 = view −z)
      const q = new THREE.Quaternion()
        .setFromEuler(new THREE.Euler(-20 * Math.PI / 180, 0, 0, 'YXZ'))
        .multiply(obj.quaternion);                                          // like the pitch slider (negative = lean fwd)
      obj.quaternion.copy(q);
      comp.orientation = { w: q.w, x: q.x, y: q.y, z: -q.z };
      const text = H.serialize(), ref = JSON.parse(text);
      const seat = ref.data.components[idx], occ = seat.occupancies[0];
      const mir = ref.data.blocks.find(b => b.type === 255 && b.size_x === 1 && b.size_y === 5
                 && b.size_z === 2 && b.pos_z === occ.pos_z);
      const ok1 = occ.pos_z === H.orig[idx].occ0[0].pos_z + 1;
      const ok3 = JSON.stringify(JSON.parse(text)) === text;
      // view-space handedness (default craft ISW-241): the beacon's mast must
      // lean toward the NOSE (view +z). Its 180° quaternion read raw points the
      // mast at the tail — exactly the user's "points the wrong way" bug.
      const bi = H.model.data.components.findIndex(c => c.type === 'Beacon');
      const mast = bi >= 0 ? new THREE.Vector3(0, 1, 0).applyQuaternion(H.compObjs[bi].quaternion) : null;
      const ok4 = !!mast && mast.z > 0.9 && Math.abs(mast.x) < 0.2;
      // wheels hang below the mount in-game (suspension droop, display-only):
      // the ISW front caster's centre must sit BELOW its pivot, not at deck height
      const wi = H.model.data.components.findIndex(c =>
        c.type === 'SmallWheel' && Math.abs(c.orientation.x) > 0.5);   // the front caster
      const wc = new THREE.Vector3(0, 0.447, 0).applyQuaternion(H.compObjs[wi].quaternion);
      const ok6 = wc.y < -0.3;
      // FluidJunction flat display pose: builder-file cables attach from
      // ABOVE (outlets up, row along the fuselage), so the inlet faces DOWN
      const ji = H.model.data.components.findIndex(c => c.type === 'FluidJunction');
      const jdir = new THREE.Vector3(0, 0, 1).applyQuaternion(H.compObjs[ji].quaternion);
      const ok7 = jdir.y < -0.9;
      // aileron deflection = saved data.angle in DEGREES (.ini joint limits
      // ±45°): the ISW front canard (−4.609°) droops its leading edge a few
      // degrees below the hinge, view tip dir = qV · Mz · R_x(rad) · (0,0,1)
      const ac = H.model.data.components.find(c =>
        c.type === 'Aileron' && c.data && c.data.angle < -3);
      const aqp = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(1, 0, 0), ac.data.angle * Math.PI / 180);
      const at = new THREE.Vector3(0, 0, 1).applyQuaternion(aqp);
      at.z = -at.z; at.applyQuaternion(H.viewQuat(ac.orientation));
      const ok8 = at.y < -0.03 && at.y > -0.3;   // drooping, within joint limits
      // v1-format files (23 of 24 corpus files!) carry NO data.colors palette:
      // slots must resolve against the built-in legacy groups (dashboard
      // mosaic craft lives in 40..56: slot 48 = matte dark green [1,8,1]);
      // v1 component colours are [slot,slot] palette INDICES, not dicts
      const lc = resolveColor(null, 48), lc2 = resolveColor(null, 53);
      const v1c = H.compColor({ colors: [48, 42] }, 'color1');
      // v1 family-base remap: v1 polished starts at 80 (v2: 84) — slot 81 must
      // resolve to v2-85 [16,16,16] in v1 files (the purple-block fix), and
      // stay the magenta marker for modern files (255,0,255)
      const l3 = resolveColor(null, 81, true), l4 = resolveColor(null, 81);
      const ok9 = lc.r === 1 && lc.g === 8 && lc.b === 1 && lc2.b === 255
        && Math.abs(v1c.color.r - 1 / 255) < 1e-3 && Math.abs(v1c.color.g - 8 / 255) < 1e-3
        && l3.r === 16 && l3.g === 16 && l3.b === 16 && l4.r === 255 && l4.g === 0 && l4.b === 255;
      // Beacon reads as a beacon: the game's red flash is procedural (no lens
      // material in the gltf), so the viewer adds an emissive red lens at the
      // mast tip of every real/low beacon model (user: "beacon no longer
      // looks like a beacon")
      let ok10 = false;
      { const mm = await H.getModel('Beacon');
        if (mm?.geo) {
          const rg = H.buildRealComponent(H.model.data.components[bi], mm, bi, true);
          rg.traverse(o => { if (o.material?.emissive?.getHex() === 0xff2222) ok10 = true; });
        } }
      // orient-fixture rules (testdata/9000000001, pixel-proven side-by-side
      // with the dev viewer): dashboard canvas text must be PRE-MIRRORED and
      // baked text prims mirrored in-plane about their own centre, so both
      // read correctly from the plate's authored (+normal) side through our
      // z-mirror. ok11: left-aligned 'AB' lands on the canvas RIGHT edge.
      const ok11 = (() => {
        const t = H.dashTextTex({ text: 'AB', textSize: 2, textAlign: 17, size_x: 40, size_y: 12,
          mainColor: { r: 255, g: 0, b: 0 }, baseColor: { r: 0, g: 0, b: 0 } });
        const cv = t.image, cx = cv.getContext('2d', { willReadFrequently: true });
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        let left = 0, right = 0;
        for (let i = 0, px = 0; i < d.length; i += 4, px++)
          if (d[i] > 200 && d[i + 1] < 100) (px % cv.width < cv.width / 2 ? left++ : right++);
        return right > 20 && left === 0;   // pre-mirrored: left-aligned text lands right
      })();
      // ok12: flipGeomX mirrors about the bbox centre (triangle (0,0)(1,0)(0,1)
      // → first vertex at x=1) — glyph order flips, position is preserved.
      const ok12 = (() => {
        const tg = new THREE.BufferGeometry();
        tg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
        tg.setIndex([0, 1, 2]);
        H.flipGeomX(tg);
        return Math.abs(tg.attributes.position.array[0] - 1) < 1e-6;
      })();
      // ok13: legacy rotation convention (no data.colors => RAW Unity LH
      // quaternions): the mosaic craft's man-mural constellation (dash 235's
      // wall: 17 coplanar dashboards, spread 0.26 m) is flush only under raw
      // R(q) (|dot| 0.999); conjugate quaternions tilt every plate ~45° out
      // of the wall (|dot| 0.70 = user's "not flush" screenshots).
      let ok13 = false;
      let ok13b = false;
      {
        const ms = await (await fetch('../testdata/3334698274/blueprint.json')).json();
        const dc = ms.data.components[235];
        if (dc.type === 'Dashboard') {
          const qv = new THREE.Quaternion(-dc.orientation.x, -dc.orientation.y,
                                         dc.orientation.z, dc.orientation.w);   // legacy view rule
          const n = new THREE.Vector3(0, 0, -1).applyQuaternion(qv);   // +Z face through scale.z=−1
          const npl = new THREE.Vector3(0.69337, 0.63691, -0.33702).normalize();  // view wall normal
          ok13 = Math.abs(n.dot(npl)) > 0.98;
        }
        // ok13b: decoded subgrid join (v0.154, FORMAT §Subgrids): slaveBuildId
        // = the Build's index in the flattened component array (nested content
        // numbered BEFORE its Build). Jimmy's Adventure: one gantry subgrid
        // (Build[6] with 4 nested dashboards) whose single entry must decode
        // master RTG[171] — the mount proximity heuristics never found this
        // (13 m anchor), the decode finds it exactly.
        const e0 = (ms.data.composite_builds || [])[0];
        const builds13 = ms.data.components.filter(c => c.type === 'Build');
        const flat13 = new Map();
        { const T13 = (c) => { let s = 0; for (const sc of (c.data && c.data.components) || []) s += 1 + T13(sc); return s; };
          let nn = 0;
          ms.data.components.forEach((c) => {
            if (c.type === 'Build') { const t = T13(c); flat13.set(nn + t, c); nn += t; }
            nn += 1;
          }); }
        ok13b = builds13.length === 1 && !!e0 && flat13.get(e0.slaveBuildId) === builds13[0]
          && builds13[0].data.components.length === 4
          && ms.data.components[e0.component]?.type === 'RTG';
      }
      // ok14: ground fit — the green plane and grid sit just UNDER the
      // lowest rendered geometry (truck 3481322297 builds to y=-1.5:
      // nothing may render below ground; user rule), ISW included.
      // v0.161: the scan includes the OVERLAY groups (mirror plane) — the
      // rule is "nothing renders below ground, EVER", for decorations too
      // (the first mirror-plane cut pierced the ground and the suite was
      // blind to it — user screenshot 2026-10-09).
      const gbb2 = new THREE.Box3().setFromObject(H.compGroup);
      gbb2.expandByObject(H.blockGroup); gbb2.expandByObject(H.subGroup);
      gbb2.expandByObject(H.hullGroup); gbb2.expandByObject(H.pipeGroup);
      gbb2.expandByObject(H.mirrorGroup);
      const ok14 = Math.abs(H.ground.position.y - Math.min(0, gbb2.min.y - 0.02)) < 0.01
        && Math.abs(H.grid.position.y - H.ground.position.y) < 0.005;
      // ok15: cable power-surge — selecting the PilotSeat must spawn one
      // travelling pulse per connected pipe, aimed at the directly
      // connected component. Re-triggered here: the awaited mural test
      // advances virtual time, so the select()-spawned pulses already ran.
      H.startSurges(idx);
      const ok15 = H.surges.length >= 1 && H.surges.every(s => s.to >= 0 && s.total > 0.05);
      // ok16: the surge must fire a SOURCE blip on the SELECTED component
      // (Jimmy aileron report: far-end travel read as "the prop fired
      // them") and the selection border must render through geometry.
      const ok16 = H.flashes.length >= 1 && H.flashes[0].ci === idx
        && H.selBox.material.depthTest === false;
      H.clearSurges();
      // ok17: thrust indication — every propulsor (ISW RCS bank) feeds a
      // normalized net-thrust vector, and per-engine + net arrows are built
      const nThr = H.model.data.components.filter(c => c.type in H.THRUST).length;
      // windsock HUD: camera child, aims its +z (tail) downwind in camera
      // space: dot(sock z, flowDir in cam space) ~ 1 (ok19)
      let ok19 = false;
      { H.setFlowMode('wind'); H.updateWindHud(performance.now());   // aim once (rAF has not run)
        if (H.windHud.visible && H.sockPivot && H.windHud.parent === H.camera) {
          const dv = H.flowDir();
          const dcam = new THREE.Vector3(dv[0], dv[1], -dv[2])
            .applyQuaternion(H.camera.quaternion.clone().invert()).normalize();
          const z = new THREE.Vector3(0, 0, 1).applyQuaternion(H.sockPivot.quaternion);
          ok19 = z.dot(dcam) > 0.93;
        }
        H.setFlowMode('off'); }
      // ok20: hull-solid and wireframe are mutually exclusive (user)
      let ok20 = false;
      { const cbs = [...document.querySelectorAll('input[type=checkbox]')];
        const find = t => cbs.find(c => (c.parentElement.textContent || '').includes(t));
        const h = find('hull (blocks + triangles)'), w = find('wireframe (hull)');
        if (h && w) {
          w.checked = true; w.dispatchEvent(new Event('change'));
          const a = !h.checked && !H.blockGroup.visible && H.hullWire.visible;
          h.checked = true; h.dispatchEvent(new Event('change'));
          ok20 = a && !w.checked && H.blockGroup.visible && !H.hullWire.visible;
        } }
      // ok21: physics-LOD budget — normal crafts keep all 4000 particles (v0.156)
      const ok21 = H.flowPts && H.flowPts.geometry.attributes.position.count === 4000 && H.flowN === 4000;
      // ok22: clicking a component on the canvas selects it via the
      // pointerdown raycast (no hover path exists anymore)
      let ok22 = false;
      { const si = H.compObjs.findIndex(o => !!o);
        if (si >= 0) {
          const v = new THREE.Vector3(); H.compObjs[si].getWorldPosition(v); v.project(H.camera);
          const r = H.renderer.domElement.getBoundingClientRect();
          const x = r.left + (v.x * 0.5 + 0.5) * r.width, y = r.top + (-v.y * 0.5 + 0.5) * r.height;
          const ev = (t) => H.renderer.domElement.dispatchEvent(new PointerEvent(t,
            { clientX: x, clientY: y, bubbles: true, pointerId: 1, isPrimary: true }));
          const prev = H.selected;
          ev('pointerdown'); ev('pointerup');
          ok22 = H.selected === si;
          H.fly = null; H.select(prev, false);       // undo camera side effects
        } }
      // ok23: streamlines are undisturbed UPSTREAM of the body mid-plane
      // (user: 'things magically happen 10 m in front of Jimmy'). Every line
      // vertex with dot(p-cen,dir) < 0 must sit laterally within 0.45 m of
      // its seed ring radius (straight run-in + heading low-pass tolerance).
      let ok23 = false;
      { H.setFlowMode('lines');
        const dvL = new THREE.Vector3(...H.flowDir()).normalize();
        const bL = H.model.box_min, BL = H.model.box_max;
        const cenL = new THREE.Vector3((bL.x + BL.x) / 2, (bL.y + BL.y) / 2, (bL.z + BL.z) / 2);
        const seedR = [];
        { const ref = Math.abs(dvL.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
          const e1L = ref.cross(dvL).normalize();
          const e2L = new THREE.Vector3().crossVectors(dvL, e1L).normalize();
          const radL = Math.hypot(BL.x - bL.x, BL.y - bL.y, BL.z - bL.z) / 2 * 1.1 + 0.5;
          for (let a = -radL; a <= radL; a += 1.7)
            for (let c2 = -radL; c2 <= radL; c2 += 0.55)
              if (a * a + c2 * c2 <= radL * radL) seedR.push(Math.hypot(a, c2));
        }
        let worst = 0;
        for (const o of H.flowGroup.children) {
          if (!o.isLine || o.userData.isTrail || o.userData.isLineHot) continue;
          const pos = o.geometry.attributes.position.array;
          for (let i = 0; i < pos.length; i += 3) {
            const px = pos[i] - cenL.x, py = pos[i + 1] - cenL.y, pz = pos[i + 2] - cenL.z;
            if (px * dvL.x + py * dvL.y + pz * dvL.z >= 0) continue;     // wake side: waves allowed
            const t = px * dvL.x + py * dvL.y + pz * dvL.z;
            const ux = px - t * dvL.x, uy = py - t * dvL.y, uz = pz - t * dvL.z;
            const lat = Math.hypot(ux, uy, uz);
            let m = 1e9;
            for (const r of seedR) { const d = Math.abs(lat - r); if (d < m) m = d; }
            if (m > worst) worst = m;
          }
        }
        ok23 = worst < 0.45 && H.flowGroup.children.some(o => o.isLine && !o.userData.isTrail);
        H.setFlowMode('off'); }
      // ok24: wake deficit — air directly behind Jimmy's tail is slowed
      // (>25 % deficit), air ahead of the nose is at freestream
      let ok24 = false;
      { const dvW = H.flowDir();
        const bl = H.model.box_min, Bg = H.model.box_max;
        const cW = [(bl.x + Bg.x) / 2, (bl.y + Bg.y) / 2, (bl.z + Bg.z) / 2];
        const ext = Math.abs((Bg.x - bl.x) / 2 * dvW[0]) + Math.abs((Bg.y - bl.y) / 2 * dvW[1]) + Math.abs((Bg.z - bl.z) / 2 * dvW[2]);
        const VB = 60;
        // mid-way between axis and hull TOP skin: the ISW tail centre is its
        // open engine duct (air, casts no wake); the top skin is solid
        const yTop = (Bg.y + cW[1]) / 2 - 0.15;
        const pb = [cW[0] + dvW[0] * (ext + 1.5), yTop, cW[2] + dvW[2] * (ext + 1.5)];
        const pf = [cW[0] - dvW[0] * (ext + 1.5), yTop, cW[2] - dvW[2] * (ext + 1.5)];
        const vb = H.sampleVel(pb, dvW, VB), vf = H.sampleVel(pf, dvW, VB);
        ok24 = Math.hypot(vb[0], vb[1], vb[2]) < VB * 0.75 && (vb[3] || 0) > 0.3
          && Math.hypot(vf[0], vf[1], vf[2]) > VB * 0.95 && !(vf[3] > 0);
      }
      // ok25: chair pitch is a COMFORT axis — pitching the pilot seat must
      // not steer the wind (user: 'pitch the chair and the wind direction
      // and speed change'); wind keeps heading + unit length
      let ok25 = false;
      { const seatCi = H.model.data.components.findIndex(c => c.type === 'PilotSeat');
        const so = seatCi >= 0 ? H.compObjs[seatCi] : null;
        if (so) {
          const d0 = H.flowDir();
          const q = so.quaternion.clone();
          so.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.35));
          const d1 = H.flowDir();
          so.quaternion.copy(q);
          ok25 = d0[0] * d1[0] + d0[1] * d1[1] + d0[2] * d1[2] > 0.9999
            && Math.abs(Math.hypot(...d0) - 1) < 0.01 && Math.abs(Math.hypot(...d1) - 1) < 0.01;
        } }
      // ok26: display anchoring — ISW is built at frame (0,0,0), so the
      // v0.140 moff/cv display transform must be a pure no-op (bit-identical)
      const ok26 = H.model.moff[0] === 0 && H.model.moff[1] === 0 && H.model.moff[2] === 0
        && H.model.cv[0] === 0 && H.model.cv[1] === 0 && H.model.cv[2] === 0
        && isFinite(H.model.box_min.x) && H.blockGroup.position.lengthSq() === 0;
      // ok27: rotate gizmo writeback shape — a 0.7 rad drag about view +y
      // (the trackball's world-premultiply form) applied to the PilotSeat
      // must land VERBATIM in the mesh quaternion and round-trip the file
      // quaternion (viewQuat∘rawFromView = id): the seat's saved pitch makes
      // the z component nonzero, so any mirror/conjugation slip in the chain
      // fails (v0.150 shipped exactly such a flipZ step; ?gizmatest covers
      // the ring-order semantics, this pins the writeback path)
      let ok27 = false;
      (function () {
        const ci = H.model.data.components.findIndex(c => c.type === 'PilotSeat');
        H.select(ci);
        const o = H.compObjs[ci];
        H.scene.updateMatrixWorld(true);
        const q0 = o.getWorldQuaternion(new THREE.Quaternion());   // visible pose
        const drag = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
        const pq = drag.multiply(q0);                              // what TControls computes
        H.applyGizmoOrientation(pq);
        const qf = H.model.data.components[ci].orientation;
        const want = pq.clone().multiply(H.GIZMO_Y180);   // proxy frame → mesh frame
        ok27 = Math.abs(H.viewQuat(qf).dot(want)) > 0.9999           // file → view decode
          && Math.abs(o.quaternion.dot(want)) > 0.9999             // live mesh pose
          && H.dirty;
        H.select(-1);
      })();
      // ok28: fat-line SELECTION OUTLINE (v0.156 user "selection should be
      // more clear"): visible with all 12 box segments on a selection, hidden
      // on none. ok29: connectors (adapter nubs) hidden by DEFAULT, cables
      // stay (v0.156 user default).
      let ok28 = false, ok29 = H.adpGroup.visible === false && H.pipeGroup.visible;
      (function () {
        const ci = H.model.data.components.findIndex(c => c.type === 'PilotSeat');
        H.select(ci); H.paintHighlights();
        ok28 = H.selBox.visible && H.selBox.geometry.getAttribute('instanceStart').count === 12;
        H.select(-1); H.paintHighlights();
        ok28 = ok28 && !H.selBox.visible;
      })();
      const ok17 = nThr > 0 && !!H.netThrust && H.netThrust.n === nThr
        && H.thrustGroup.children.length === nThr + (H.netThrust.v ? 1 : 0)
        && (!H.netThrust.v || Math.abs(Math.hypot(...H.netThrust.v) - 1) < 0.02)
        // ISW = sole-class RCS blob: the blueprint stores none of the game's
        // 5 selectable fire directions, so it displays the NORMAL mode —
        // push BACKWARD along −cockpit heading = view (0,0,−1) (user: "no
        // downward propulsion"; the old .ini-TARGET-axis guess drew a
        // straight-down arrow at the nose pod). RCS is excluded from the
        // nets entirely when real engines coexist. Auto flow still takes the
        // cockpit first; aoa 4° keeps |y| = sin4° ≈ 0.07.
        && !!H.netThrust.main && H.netThrust.main[2] < -0.97
        && Math.abs(H.netThrust.main[0]) < 0.05 && Math.abs(H.netThrust.main[1]) < 0.05
        && H.netThrust.v[2] < -0.97 && Math.abs(H.flowDir()[1]) < 0.2;
      // ok18: sealed-hull wind exclusion (user: no wind inside enclosed
      // craft): BionicDolphin (block hull, hatches stored closed) has a
      // ray-enclosed cabin of 100+ cells that is windless, its far field
      // windy; the live ISW grid exists and its far field is exterior.
      const dp = await (await fetch('../testdata/3417786605/blueprint.json')).json();
      const seal = H.sealStats(dp.data);
      const sp = seal.sealedSample;
      const sgx = Math.round(sp[0] / 0.25) - seal.b0[0];
      const sgy = Math.round(sp[1] / 0.25) - seal.b0[1];
      const sgz = Math.round(sp[2] / 0.25) - seal.b0[2];
      const ok18 = !!H.extGrid && H.inExterior([H.model.box_min.x - 2, 0, 0])
        && seal.sealedCount > 100
        && seal.ext[((sgy * seal.n[0]) + sgx) * seal.n[2] + sgz] !== 1
        && seal.ext[0] === 1;
      // picking must work through the mirrored component transforms
      // (camera aimed at the selected component: load framing is
      // per-craft now, the pin must not depend on it)
      {
        const bb = new THREE.Box3().setFromObject(obj);
        const c = bb.getCenter(new THREE.Vector3());
        H.controls.target.copy(c);
        H.camera.position.copy(c).add(new THREE.Vector3(1.2, 0.8, 1.5));
        H.camera.near = 0.01; H.camera.far = 100; H.camera.updateProjectionMatrix();
        H.camera.updateMatrixWorld(true);
      }
      H.ray.setFromCamera(new THREE.Vector2(0, 0), H.camera);
      const ok5 = H.ray.intersectObjects(H.compGroup.children, true)
        .some(h => h.object.userData.ci >= 0);
      document.title = 'SELFTEST ' + (ok1 && mir && ok3 && ok4 && ok5 && ok6 && ok7 && ok8 && ok9 && ok10 && ok11 && ok12 && ok13 && ok14 && ok15 && ok16 && ok17 && ok18 && ok19 && ok20 && ok21 && ok22 && ok23 && ok24 && ok25 && ok26 && ok27 && ok28 && ok29 ? 'PASS' : 'FAIL')
        + ' occ_z=' + occ.pos_z + ' mirror=' + !!mir
        + ' pitch=' + (2 * Math.asin(-seat.orientation.x) * 180 / Math.PI).toFixed(1) + '°'
        + ' beacon=' + (mast ? mast.x.toFixed(2) : 'none') + ' droop=' + wc.y.toFixed(2)
        + ' junction=' + jdir.y.toFixed(2) + ' aileron=' + at.y.toFixed(2)
        + ' pick=' + ok5 + ' palette=' + ok9 + ' lens=' + ok10
        + ' dashmirror=' + ok11 + ' textx=' + ok12 + ' mural=' + ok13 + ' subjoin=' + ok13b + ' ground=' + ok14
        + ' surges=' + ok15 + ' bolts=' + ok16 + ' thrust=' + ok17 + ' seal=' + ok18 + ' sock=' + ok19 + ' excl=' + ok20 + ' windpts=' + ok21 + ' click=' + ok22 + ' inflow=' + ok23 + ' wake=' + ok24 + ' seatpitch=' + ok25 + ' anchor=' + ok26 + ' gizmo=' + ok27 + ' outline=' + ok28 + ' conndef=' + ok29
        + ' cabin=' + seal.sealedCount;
    } catch (e) { document.title = 'SELFTEST ERR ' + e.message + ' @' + String(e.stack).split(String.fromCharCode(10))[1].trim().slice(0, 70); }
  }, 1500);
}

// ---------- dispatch ----------
if (location.search.includes('proxytest')) runProxyTest();
if (location.search.includes('comptest')) runCompTest();
if (location.search.includes('postest')) runPosTest();
if (location.search.includes('uitest')) setTimeout(runUiTest, 1500);
if (location.search.includes('gizmatest')) runGizmoTest();
