// hull.ts — hull triangle SKIN: the game renders every hull triangle as a
// closed 0.05 m prism (±HULL_T about the surface), NOT a flat sheet:
//   colours[0] = front face (+normal), colours[1] = back face,
//   colours[2..4] = the three side walls along edges v0-v1, v1-v2, v2-v0.
// All five colours matter (ISW-241 uses slots 0/4/51 = hull/glass/chrome);
// a single-triangle render reads paper-thin from the side (P2a look).
//
// Winding (legacy buildHull, carried verbatim): vertices are already in
// VIEW space (z-mirrored, handedness flipped), so the FRONT normal is the
// cross of the FLIPPED winding — cross(p2−p0, p1−p0) — and each emitted
// face below is already in its final outward-wound order.

import type { Triangle } from './format';
import { hullVertex } from './hullfit';

/** half-thickness of the hull skin (m) — legacy HULL_T. */
export const HULL_T = 0.025;

export type V3 = readonly [number, number, number];

/** One outward-wound view-space triangle of the prism + its palette slot. */
export interface HullFace {
  slot: number;
  tri: readonly [V3, V3, V3];
}

export interface HullSkin {
  faces: HullFace[];
  /** raw surface edges (2 verts per edge) for the wireframe overlay */
  wire: number[];
  tris: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0]!, a[1] - b[1]!, a[2] - b[2]!];
const cross = (a: V3, b: V3): V3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

/** prism faces for one triangle file record (view-space output) */
export function hullPrism(t: Triangle): HullFace[] {
  const p: [V3, V3, V3] = ([0, 1, 2] as const).map(i => {
    const v = hullVertex(t, i);
    return [v.x, v.y, -v.z] as V3;
  }) as [V3, V3, V3];

  // FRONT normal (view space) = cross of the flipped winding
  const n = cross(sub(p[2], p[0]), sub(p[1], p[0]));
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const u: V3 = [n[0]! / len, n[1]! / len, n[2]! / len];
  const off = (v: V3, s: number): V3 => [v[0]! + u[0]! * s, v[1]! + u[1]! * s, v[2]! + u[2]! * s];
  const F = p.map(v => off(v, HULL_T)) as [V3, V3, V3];
  const B = p.map(v => off(v, -HULL_T)) as [V3, V3, V3];

  const slot = (i: number): number => t.colors?.[i] ?? 0;
  const faces: HullFace[] = [
    { slot: slot(0), tri: [F[2]!, F[1]!, F[0]!] },        // front (flipped winding)
    { slot: slot(1), tri: [B[0]!, B[1]!, B[2]!] },        // back
  ];
  for (let i = 0; i < 3; i++) {                           // side walls, edge i→j
    const j = (i + 1) % 3;
    const s = slot(2 + i);
    faces.push({ slot: s, tri: [B[j]!, B[i]!, F[i]!] });
    faces.push({ slot: s, tri: [B[j]!, F[i]!, F[j]!] });
  }
  return faces;
}

/** whole skin: every triangle of the file → prism faces + wire edges */
export function buildHullSkin(triangles: readonly Triangle[] | undefined): HullSkin {
  const faces: HullFace[] = [];
  const wire: number[] = [];
  for (const t of triangles ?? []) {
    faces.push(...hullPrism(t));
    const p: V3[] = ([0, 1, 2] as const).map(i => {
      const v = hullVertex(t, i);
      return [v.x, v.y, -v.z];
    });
    for (let i = 0; i < 3; i++) {
      const a = p[i]!, b = p[(i + 1) % 3]!;
      wire.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
    }
  }
  return { faces, wire, tris: (triangles ?? []).length };
}
