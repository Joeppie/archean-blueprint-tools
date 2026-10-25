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

// ------------------------------------------------- PANEL VERTEX EDITING
// v1.10.6 TRIANGLE WORKSPACE (we: "editing triangles also sucks"): the dock
// edits a selected triangle's corners as GLOBAL lattice corners g (the same
// indices cornerOf snaps clicks to — world = (g − 6)·CELL). Every write
// re-factorises (frame, v) exactly like triangleFromCorners (f = floorDiv
// (min, 12), v starts near 0, the game-writer style) and REFUSES records
// whose per-axis span exceeds the 32-slot vertex window (v ∈ 0..31, FORMAT
// §Triangles) — an honest refusal, never a silently deformed skin. Each
// helper mutates the live record and returns the numeric fields it changed
// (name → value, e.g. { v0_x: 14, frame_x: 1 }) so the caller mirrors
// EXACTLY those onto the doc path ['data','triangles', ti] — the doc is the
// save and the undo history (v1.6.1 rule).

/** The three GLOBAL corner indices of a stored triangle. */
export function triCorners(t: Triangle): [Corner, Corner, Corner] {
  const o = t as unknown as Record<string, number>;
  const g = (ax: number): [number, number, number] => {
    const f = o[`frame_${'xyz'[ax]!}`] ?? 0;
    return [0, 1, 2].map(i => (o[`v${i}_${'xyz'[ax]!}`] ?? 0) + 12 * f) as [number, number, number];
  };
  const ax = g(0), ay = g(1), az = g(2);
  return [[ax[0]!, ay[0]!, az[0]!], [ax[1]!, ay[1]!, az[1]!], [ax[2]!, ay[2]!, az[2]!]];
}

/** Refactor corner list → (frame, v) per axis (f = floorDiv(min, 12), v
 *  starts near 0 like the game writer). Returns the changed numeric fields,
 *  or null when an axis breaks the game's vertex law: the 32-slot window is
 *  FRAME-ALIGNED (v1.5.17 finding) — v = g − 12·floor(min/12) must stay
 *  ∈ 0..31, so a shift that pushes the fattest vertex past the frame's
 *  window is REFUSED, not silently hoisted (that is what encodeSkinTri and
 *  the hullify writer enforce over generated records). */
function refactorTri(c: [Corner, Corner, Corner]): Record<string, number> | null {
  const delta: Record<string, number> = {};
  for (let ax = 0; ax < 3; ax++) {
    const name = 'xyz'[ax]!;
    const vs = c.map(g => g[ax]!);
    const f = floorDiv(Math.min(...vs), 12);
    if (Math.max(...vs) - 12 * f > 31) return null;    // 32-slot vertex window
    c.forEach((g, i) => { delta[`v${i}_${name}`] = g[ax]! - 12 * f; });
    delta[`frame_${name}`] = f;
  }
  return delta;
}

/** Apply a (frame, v) refactor to the record, keeping fields not listed in
 *  `delta` verbatim; returns the fields the record did not already carry. */
function applyTriDelta(t: Triangle, delta: Record<string, number>): Record<string, number> {
  const o = t as unknown as Record<string, number | number[] | string>;
  const changed: Record<string, number> = {};
  for (const [k, v] of Object.entries(delta)) {
    if (o[k] === v) continue;
    o[k] = v;
    changed[k] = v;
  }
  return changed;
}

/** Move ONE corner of a triangle to a new GLOBAL lattice corner index.
 *  Mutates + returns the changed record fields, null = refused (the vertex
 *  window, degenerate corners). */
export function setTriCorner(t: Triangle, i: number, ax: number, g: number):
  Record<string, number> | null {
  const c = triCorners(t);
  const nc: [Corner, Corner, Corner] = c.map(q => [...q] as Corner) as [Corner, Corner, Corner];
  nc[i]![ax] = Math.round(g);
  if ([0, 1, 2].some(k => k !== i && nc[k]![0] === nc[i]![0] && nc[k]![1] === nc[i]![1]
    && nc[k]![2] === nc[i]![2])) return null;                 // two corners coincide
  const d = refactorTri(nc);
  return d ? applyTriDelta(t, d) : null;
}

/** Move ONE corner to a new GLOBAL lattice corner on ALL THREE axes (the
 *  v1.11 PIN editor: a pin drag lands on a surface point, cornerOf snaps the
 *  full 3-vector). Same contract as setTriCorner (mutates, returns the
 *  changed fields, null = refused: coincident corners / the 32-slot window). */
export function setTriCornerAll(t: Triangle, i: number, g: Corner):
  Record<string, number> | null {
  const c = triCorners(t);
  const nc: [Corner, Corner, Corner] = c.map(q => [...q] as Corner) as [Corner, Corner, Corner];
  nc[i] = [Math.round(g[0]!), Math.round(g[1]!), Math.round(g[2]!)];
  if ([0, 1, 2].some(k => k !== i && nc[k]![0] === nc[i]![0] && nc[k]![1] === nc[i]![1]
    && nc[k]![2] === nc[i]![2])) return null;
  const d = refactorTri(nc);
  return d ? applyTriDelta(t, d) : null;
}

/** Move ALL THREE corners at once (the v1.11 centroid widget's ROTATE
 *  commit: the engine quantises the rotated corners back onto the lattice,
 *  this writes them atomically). Same contract as setTriCorner: mutates,
 *  returns the changed fields, null = refused (ANY pair coincident / the
 *  32-slot window) — a refused rotate leaves the record byte-intact. */
export function setTriCornersAll(t: Triangle, ng: [Corner, Corner, Corner]):
  Record<string, number> | null {
  const nc = ng.map(g => [Math.round(g[0]!), Math.round(g[1]!), Math.round(g[2]!)] as Corner);
  for (let i = 0; i < 3; i++)
    for (let k = i + 1; k < 3; k++)
      if (nc[i]![0] === nc[k]![0] && nc[i]![1] === nc[k]![1] && nc[i]![2] === nc[k]![2])
        return null;
  const d = refactorTri(nc as [Corner, Corner, Corner]);
  return d ? applyTriDelta(t, d) : null;
}

/** The ⇄ MIRROR TWIN of a triangle (v1.11, we: "mirror for triangle is not
 *  placed"): corners g reflect across the session plane's cell-coord 6
 *  (g → 12 − g, the same law as mirrorBlockCell on the corner lattice), and
 *  v1↔v2 SWAP — an axis reflection flips the winding normal's mirror image
 *  (det = −1), so the swap restores colours[0] FRONT = the mirrored front
 *  direction, exactly like MIRROR_TYPES does for block shapes. The side
 *  wall colours follow the edge relabelling: colours[2] (v0-v1) ↔
 *  colours[4] (v2-v0), colours[3] (v1-v2) stays. */
export function mirroredTriangle(t: Triangle, axis: 'x' | 'y' | 'z'): Triangle | null {
  const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const c = triCorners(t).map(g => {
    const m: Corner = [g[0]!, g[1]!, g[2]!];
    m[a] = 12 - m[a]!;
    return m;
  }) as [Corner, Corner, Corner];
  const cols = ((t as unknown as { colors?: number[] }).colors ?? [51, 51, 51, 51, 51]).slice(0, 5);
  const twin = triangleFromCorners(c[0]!, c[2]!, c[1]!,   // winding flipped
    [cols[0]!, cols[1]!, cols[4]!, cols[3]!, cols[2]!]);
  if (twin) {
    const mat = (t as unknown as { material?: number }).material;
    if (mat != null) (twin as unknown as { material: number }).material = mat;
    const sm = (t as unknown as { smooth?: number }).smooth;
    if (sm === 1) (twin as unknown as { smooth: number }).smooth = 1;
  }
  return twin;
}

/** v1.11 the twin INDEX of a triangle (the uniform mirror rule's identifier,
 *  we: "when I moved a triangle, it didn't see it as mirrored"): the twin is
 *  the other record whose corner SET is the x/y/z-reflection (g → 12 − g) of
 *  this one's. Winding-agnostic (a sorted-set key), so the pair survives
 *  flips; a drifted pair simply stops matching (faux-mirror semantics). */
export function triTwinIndex(bp: Blueprint, ti: number, axis: 'x' | 'y' | 'z'): number {
  const arr = bp.data.triangles ?? [];
  const t = arr[ti];
  if (!t) return -1;
  const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const key = (cs: readonly Corner[]): string =>
    cs.map(g => [g[0]!, g[1]!, g[2]!]).sort((p, q) => p[0]! - q[0]! || p[1]! - q[1]! || p[2]! - q[2]!)
      .map(g => g.join(',')).join(';');
  const want = key(triCorners(t).map(g => {
    const m: Corner = [g[0]!, g[1]!, g[2]!];
    m[a] = 12 - m[a]!;
    return m;
  }));
  for (let i = 0; i < arr.length; i++) {
    if (i === ti) continue;
    if (key(triCorners(arr[i]!)) === want) return i;
  }
  return -1;
}

/** v1.11 rotate a corner triple about its CENTROID by the quaternion q and
 *  re-snap every corner to the lattice (the mirrored twin's rotate uses
 *  qM = the mirror conjugate: qM[i] = (i === mirrorAxis ? q[i] : −q[i]) with
 *  w kept — the engine's ⟳ commit pairs the two writes in one step). */
export function rotateCornersQ(base: readonly [Corner, Corner, Corner],
  q: { w: number; x: number; y: number; z: number }): [Corner, Corner, Corner] {
  const f = base.map(g => [(g[0]! - 6) * CELL, (g[1]! - 6) * CELL, (g[2]! - 6) * CELL]);
  const cen = [0, 1, 2].map(i => (f[0]![i]! + f[1]![i]! + f[2]![i]!) / 3);
  const out = base.map((_, k) => {
    const v = [f[k]![0]! - cen[0]!, f[k]![1]! - cen[1]!, f[k]![2]! - cen[2]!];
    const { w, x, y, z } = q;
    const tx = 2 * (y * v[2]! - z * v[1]!);
    const ty = 2 * (z * v[0]! - x * v[2]!);
    const tz = 2 * (x * v[1]! - y * v[0]!);
    const rx = v[0]! + w * tx + (y * tz - z * ty);
    const ry = v[1]! + w * ty + (z * tx - x * tz);
    const rz = v[2]! + w * tz + (x * ty - y * tx);
    return cornerOf([rx + cen[0]!, ry + cen[1]!, rz + cen[2]!]);
  });
  return out as [Corner, Corner, Corner];
}

/** Shift the WHOLE triangle by integer cells (the dock's ± rows). Same
 *  contract as setTriCorner. */
export function shiftTriCells(t: Triangle, d: readonly [number, number, number]):
  Record<string, number> | null {
  const c = triCorners(t);
  const nc: [Corner, Corner, Corner] = [
    [c[0]![0]! + d[0]!, c[0]![1]! + d[1]!, c[0]![2]! + d[2]!],
    [c[1]![0]! + d[0]!, c[1]![1]! + d[1]!, c[1]![2]! + d[2]!],
    [c[2]![0]! + d[0]!, c[2]![1]! + d[1]!, c[2]![2]! + d[2]!],
  ];
  const r = refactorTri(nc);
  return r ? applyTriDelta(t, r) : null;
}

/** The triangle's per-axis cell spans (its size in lattice cells). */
export function triSpan(t: Triangle): [number, number, number] {
  const c = triCorners(t);
  const sp = (ax: number) =>
    Math.max(c[0]![ax]!, c[1]![ax]!, c[2]![ax]!) - Math.min(c[0]![ax]!, c[1]![ax]!, c[2]![ax]!);
  return [sp(0), sp(1), sp(2)];
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
