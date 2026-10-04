// hullfit.js — derive hull-triangle grid constants for an Archean blueprint.
//
// Findings from vertex-sharing analysis (per blueprint, re-derived here):
//  * Triangle vertices are SLOTS on a lattice: (frame, v_x,v_y,v_z). Shared
//    slots across triangles = welded vertices (exact, in the data).
//  * Cross-frame welds appear as slot pairs with the same (v_y,v_z) and
//    Δv_x = W·Δframe_x (W = lattice slots per frame tile, ~14): e.g. a canopy
//    ridge point stored at v_x 5 in frame 0 and v_x 19 in frame -1.
//    Bottom counterparts at W±2 reveal a deliberate 2-slot GAP (an opening).
//  * So world = (v + W·frame)·pitch + C, per axis, with anisotropic pitches.
//    Fitting canonical slot indices tight to the bounding box fixes pitch and
//    offset per axis; y pitch is anchored by aileron height (wing layer) and
//    the box top (fin/skin apex). Nothing is hardcoded per craft.
//
// Returns { W, px, py, pz, Cx, Cy, Cz, d } with world_ax = (v_ax + W·f_ax)·p_ax + C_ax
export function fitHull(bp) {
  const T = bp.data.triangles;
  if (!T.length) return null;
  const P = [];
  for (const t of T) for (let i = 0; i < 3; i++)
    P.push({ x: t[`v${i}_x`], y: t[`v${i}_y`], z: t[`v${i}_z`],
             fx: t.frame_x, fy: t.frame_y, fz: t.frame_z, c: t.colors?.[0] ?? 0 });

  // --- W (slots per frame tile) from weld candidates -----------------------
  const dW = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
    const a = P[i], b = P[j];
    if (a.fy === b.fy && a.fz === b.fz && a.y === b.y && a.z === b.z && a.fx !== b.fx)
      dW.push(Math.abs((b.x - a.x) / (b.fx - a.fx)));
    if (a.fx === b.fx && a.fy === b.fy && a.x === b.x && a.y === b.y && a.fz !== b.fz)
      dW.push(Math.abs((b.z - a.z) / (b.fz - a.fz)));
  }
  let W = 14;
  if (dW.length) {
    const cnt = {};
    for (const w of dW) cnt[w] = (cnt[w] || 0) + 1;
    W = +Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  }
  if (!(W >= 4 && W <= 40)) W = 14;

  // --- x / z: canonical slots fitted tight to the bounding box -------------
  const fitAxis = (ax) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of P) {
      const u = p[ax] + W * p['f' + ax];
      if (u < lo) lo = u; if (u > hi) hi = u;
    }
    const span = bp['box_max'][ax] - bp['box_min'][ax];
    const p = span / (hi - lo);
    return { p, C: bp['box_min'][ax] - lo * p };
  };
  const fx_ = fitAxis('x'), fz_ = fitAxis('z');

  // --- y: anchored at wing layer (aileron height) and box top --------------
  const anchors = bp.data.components.filter(c => c.type === 'Aileron').map(c => c.position);
  const vc = {};
  for (const p of P) {
    const u = p.y + W * p.fy;
    vc[u] = (vc[u] || 0) + 1;
  }
  const uWing = +Object.entries(vc).sort((a, b) => b[1] - a[1])[0][0];
  const uTop = Math.max(...Object.keys(vc).map(Number));
  const wingY = anchors.length
    ? anchors.reduce((s, a) => s + a.y, 0) / anchors.length
    : (bp.box_min.y + bp.box_max.y) / 2;
  const py = (bp.box_max.y - wingY) / (uTop - uWing);
  const Cy = wingY - uWing * py;

  // --- quality: aileron anchor distance (informational) --------------------
  let d = 0;
  for (const p of P) {
    const X = (p.x + W * p.fx) * fx_.p + fx_.C, Z = (p.z + W * p.fz) * fz_.p + fz_.C;
    const Y = (p.y + W * p.fy) * py + Cy;
    for (const a of anchors) d += Math.hypot(X - a.x, Y - a.y, Z - a.z);
  }
  return { d, W, px: fx_.p, py, pz: fz_.p, Cx: fx_.C, Cy, Cz: fz_.C };
}
