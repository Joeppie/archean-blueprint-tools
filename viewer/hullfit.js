// hullfit.js — world mapping for hull triangles of an Archean blueprint.
//
// Hull triangle vertices live on the SAME lattice as blocks and occupancy
// boxes: each vertex carries a frame + integer slot coords, and
//     world_ax = frame_ax · 3.0 − 1.5 + v_ax · 0.25
// i.e. pitch = CELL (0.25 m), C = −FRAME/2 (−1.5 m), W = CELLS_PER_FRAME (12)
// in the (v + W·frame)·pitch + C form the viewer uses. Slots are shared by
// adjacent triangles (welded vertices); cross-frame pairs sit Δv = 12 apart.
// This is exact (verified against the game's own grid maths, confirmed by the
// developer's XenonViewer, and by weld-pair analysis of the corpus) — an
// earlier per-file "pitch fit" to the bounding box was an approximation that
// left the skin 3-15 % off the block hull and misaligned every edge.
//
// Returns { W, px, py, pz, Cx, Cy, Cz, d } with world_ax = (v_ax + W·f_ax)·p_ax + C_ax.
// `d` is informational: mean anchor distance from the fitted skin to the
// aileron layer (the wing the skin must wrap).
export function fitHull(bp) {
  const T = bp.data.triangles;
  if (!T.length) return null;
  const W = 12, P = 0.25, C = -1.5;
  const anchors = bp.data.components.filter(c => c.type === 'Aileron').map(c => c.position);
  let d = 0;
  for (const t of T) for (let i = 0; i < 3; i++) {
    const X = (t[`v${i}_x`] + W * t.frame_x) * P + C;
    const Y = (t[`v${i}_y`] + W * t.frame_y) * P + C;
    const Z = (t[`v${i}_z`] + W * t.frame_z) * P + C;
    for (const a of anchors) d += Math.hypot(X - a.x, Y - a.y, Z - a.z);
  }
  return { d, W, px: P, py: P, pz: P, Cx: C, Cy: C, Cz: C };
}
