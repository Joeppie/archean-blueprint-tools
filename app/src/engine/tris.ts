// tris.ts — the TRIANGLES placement submode model layer (pure).
// Hull triangle vertices live on the SAME lattice as blocks (AGENTS §
// Format facts, exact): world_ax = (v_ax + 12·frame_ax)·CELL − 1.5 — the
// cell-CORNER lattice. A click therefore snaps to an integer global corner
// index g = round((p + 1.5)/CELL); the stored (frame, v) split is any
// f/f−12f factorisation — we normalise f = floorDiv(min, 12) so v starts
// near 0 like the game writer. Triangle record shape copied from the files:
// { colors[5], frame_x|y|z, material, v0_x..v2_z } — colours[0] FRONT,
// [1] BACK, [2..4] the side walls along edges v0-v1, v1-v2, v2-v0.

import type { Blueprint, Triangle } from './format';
import { CELL } from './format';
import { hullVertex } from './hullfit';

export type Corner = [number, number, number];      // GLOBAL lattice corners

const floorDiv = (a: number, b: number) => Math.floor(a / b);

/** Snap a FILE-space point to the lattice corners of its cell. */
export function cornerOf(p: readonly [number, number, number]): Corner {
  return [
    Math.round(p[0] / CELL + 6),
    Math.round(p[1] / CELL + 6),
    Math.round(p[2] / CELL + 6),
  ];
}

/** Global corner -> FILE-space point on the lattice. */
export function cornerWorld(g: Corner): [number, number, number] {
  return [(g[0] - 6) * CELL, (g[1] - 6) * CELL, (g[2] - 6) * CELL];
}

export function triangleFromCorners(g0: Corner, g1: Corner, g2: Corner,
  colors: number[]): Triangle | null {
  if ((g0[0] === g1[0] && g0[1] === g1[1] && g0[2] === g1[2])
    || (g0[0] === g2[0] && g0[1] === g2[1] && g0[2] === g2[2])
    || (g1[0] === g2[0] && g1[1] === g2[1] && g1[2] === g2[2])) return null;
  const t: Record<string, number | number[]> =
    { colors: colors.slice(0, 5).map(Math.round), material: 0 };
  for (let ax = 0; ax < 3; ax++) {
    const name = 'xyz'[ax]!;
    const min = Math.min(g0[ax]!, g1[ax]!, g2[ax]!);
    const f = floorDiv(min, 12);
    t[`frame_${name}`] = f;
    [g0, g1, g2].forEach((g, i) => {
      t[`v${i}_${name}`] = g[ax]! - 12 * f;
    });
  }
  return t as unknown as Triangle;
}

/** FILE-space centroid of a stored triangle (exact lattice maths). */
export function triCentroid(t: Triangle): [number, number, number] {
  const o = t as unknown as Record<string, number>;
  const out = [0, 0, 0] as [number, number, number];
  for (let ax = 0; ax < 3; ax++) {
    const name = 'xyz'[ax]!;
    const f = o[`frame_${name}`] ?? 0;
    let s = 0;
    for (let i = 0; i < 3; i++) s += (o[`v${i}_${name}`] ?? 0) + 12 * f;
    out[ax] = (s / 3 - 6) * CELL;
  }
  return out;
}

/** 2026-10-20 CLICK-OWNER pick (the "triangles refuse to select properly" fix):
 *  the old CENTROID-radius test could not reach the middle of any triangle
 *  bigger than ~1 m — clicking a large prism hit nothing selectable, and the
 *  click fell through to the corner-DRAFT path instead. The owner now is a
 *  triangle whose MID-PLANE the point stands on (|d| ≤ maxD — the point came
 *  off that prism's ±HULL_T skin face) AND whose OUTLINE contains the
 *  projection with at least `margin` metres of clearance from every edge —
 *  clicks hugging an edge/corner stay corner-drafts (TriPanel rule: middle =
 *  select, corner = build). Ties (coplanar prisms) resolve to the deepest
 *  plane, then the widest margin. */
export function triAt(bp: Blueprint, p: readonly [number, number, number],
  margin = 0.06, maxD = 0.08): number {
  let best = -1, bestD = maxD, bestM = -1;
  (bp.data.triangles ?? []).forEach((t, i) => {
    const a = hullVertex(t, 0), b = hullVertex(t, 1), c = hullVertex(t, 2);
    const u: [number, number, number] = [b.x - a.x, b.y - a.y, b.z - a.z];
    const w: [number, number, number] = [c.x - a.x, c.y - a.y, c.z - a.z];
    const n: [number, number, number] = [
      u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const nl = Math.hypot(n[0], n[1], n[2]);
    if (nl < 1e-9) return;                              // degenerate
    n[0] /= nl; n[1] /= nl; n[2] /= nl;
    const d = (p[0] - a.x) * n[0] + (p[1] - a.y) * n[1] + (p[2] - a.z) * n[2];
    if (Math.abs(d) > maxD) return;
    // project p onto the plane, then inside-test + edge clearance via the
    // signed cross products over the n-consistent wind a→b→c (m = distance
    // to each supporting edge line, signed positive toward the interior)
    const q: [number, number, number] = [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]];
    const edges: [number, number, number, number, number, number][] = [
      [b.x - a.x, b.y - a.y, b.z - a.z, a.x, a.y, a.z],   // a→b (from a)
      [c.x - b.x, c.y - b.y, c.z - b.z, b.x, b.y, b.z],   // b→c (from b)
      [a.x - c.x, a.y - c.y, a.z - c.z, c.x, c.y, c.z],   // c→a (from c)
    ];
    let ok = true, m = Infinity;
    for (const [ex, ey, ez, ox, oy, oz] of edges) {
      const el = Math.hypot(ex, ey, ez);
      if (el < 1e-9) { ok = false; break; }
      const qx = q[0] - ox, qy = q[1] - oy, qz = q[2] - oz;
      const cr: [number, number, number] = [
        ey * qz - ez * qy, ez * qx - ex * qz, ex * qy - ey * qx];
      const side = (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2]) / el;   // signed
      if (side < m) m = side;
      if (side < 0) { ok = false; break; }               // outside this edge
    }
    if (!ok || m < margin) return;
    if (Math.abs(d) < bestD || (Math.abs(d) === bestD && m > bestM)) {
      bestD = Math.abs(d); bestM = m; best = i;
    }
  });
  return best;
}
