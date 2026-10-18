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

/** Nearest triangle whose CENTROID is within `radius` of the FILE point. */
export function triAt(bp: Blueprint, p: readonly [number, number, number],
  radius = 0.45): number {
  let best = -1, bestD = radius;
  (bp.data.triangles ?? []).forEach((t, i) => {
    const c = triCentroid(t);
    const d = Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}
