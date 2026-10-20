// hull.ts — hull triangle SKIN: the game renders every hull triangle as a
// closed 0.05 m prism (±HULL_T about the surface), NOT a flat sheet:
//   colours[0] = front face (+normal), colours[1] = back face,
//   colours[2..4] = the three side walls along edges v0-v1, v1-v2, v2-v0.
// All five colours matter (ISW-241 uses slots 0/4/51 = hull/glass/chrome);
// a single-triangle render reads paper-thin from the side (P2a look).
//
// Winding (de-mirrored v0.180, FORMAT §Chirality): vertices are in the RAW
// frame == the view frame, so the FRONT normal is the ordinary winding cross
// cross(p1−p0, p2−p0) — colours[0] paints that side, matching the game's own
// front face (the old chain mirrored the vertices and flipped the winding).

import type { Triangle } from './format';
import { hullVertex } from './hullfit';

/** half-thickness of the hull skin (m) — legacy HULL_T. */
export const HULL_T = 0.025;

export type V3 = readonly [number, number, number];

/** One outward-wound view-space triangle of the prism + its palette slot. */
export interface HullFace {
  slot: number;
  /** 0 = front cap, 1 = back cap, 2 = side wall. Only the CAPS weld their
   *  normals for the game's `smooth` flag (a continuous sheet across angled
   *  seams); the thin walls stay sharp-shaded. */
  cap: 0 | 1 | 2;
  tri: readonly [V3, V3, V3];
  /** the RAW (un-offset) triangle this prism was extruded from, and which
   *  raw vertex each cap corner came from (the weld key for smoothing) */
  raw: readonly [V3, V3, V3];
  rv: readonly [number, number, number];
  smooth: boolean;
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

/** prism faces for one triangle file record (raw frame == view frame) */
export function hullPrism(t: Triangle): HullFace[] {
  const p: [V3, V3, V3] = ([0, 1, 2] as const).map(i => {
    const v = hullVertex(t, i);
    return [v.x, v.y, v.z] as V3;
  }) as [V3, V3, V3];

  // FRONT normal = cross of the authored winding (raw frame, v0.180)
  const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const u: V3 = [n[0]! / len, n[1]! / len, n[2]! / len];
  const off = (v: V3, s: number): V3 => [v[0]! + u[0]! * s, v[1]! + u[1]! * s, v[2]! + u[2]! * s];
  const F = p.map(v => off(v, HULL_T)) as [V3, V3, V3];
  const B = p.map(v => off(v, -HULL_T)) as [V3, V3, V3];

  const slot = (i: number): number => t.colors?.[i] ?? 0;
  const smooth = !!t.smooth;                  // the game's per-triangle flag
  const faces: HullFace[] = [
    { slot: slot(0), cap: 0, tri: [F[0]!, F[1]!, F[2]!], raw: p, rv: [0, 1, 2], smooth },
    { slot: slot(1), cap: 1, tri: [B[2]!, B[1]!, B[0]!], raw: p, rv: [2, 1, 0], smooth },
  ];
  for (let i = 0; i < 3; i++) {                           // side walls, edge i→j
    const j = (i + 1) % 3;
    const s = slot(2 + i);
    faces.push({ slot: s, cap: 2, tri: [F[i]!, B[i]!, B[j]!], raw: p, rv: [i, i, j], smooth });
    faces.push({ slot: s, cap: 2, tri: [F[i]!, B[j]!, F[j]!], raw: p, rv: [i, j, j], smooth });
  }
  return faces;
}

/** absolute 0.25 m lattice slot of a vertex (frame-shifted), the game's
 *  edge-adjacency key space (Triangle.inc.glsl MakeEdge/HasSameVertices). */
function absVert(t: Triangle, i: number): [number, number, number] {
  const g = (ax: 'x' | 'y' | 'z') =>
    Math.round(((t[`v${i}_${ax}`] as number | undefined) ?? 0) +
      12 * ((t[`frame_${ax}`] as number | undefined) ?? 0));
  return [g('x'), g('y'), g('z')];
}
const vertKey = (v: readonly number[]) => v.join(',');
const edgeKey = (a: readonly number[], b: readonly number[]) => {
  const ka = vertKey(a), kb = vertKey(b);
  return ka < kb ? `${ka}#${kb}` : `${kb}#${ka}`;
};

/** whole skin: every triangle of the file → prism faces + wire edges.
 *  SHARED-EDGE WALL CULL (v1.5.10, the user's in-game close-ups of Jimmy's
 *  hull: "if you place triangles face down, they are precisely flush … you
 *  legitimately cannot tell whether it's Triangles or not" — while our old
 *  renderer drew EVERY prism's own 0.05 m side walls, so every seam showed
 *  a wall band = the "bevel", in BOTH windings): the game keys triangle
 *  EDGES for adjacency (MakeEdge), and where two triangles are joined on an
 *  edge that edge's side wall is never drawn — the slabs meet flush even at
 *  an ANGLE (the wall of one would poke through the other's cap). A lone
 *  triangle keeps all three walls (its thickness rim). Walls are culled by
 *  ADJACENCY only, independent of the smooth flag — in-game flush seams are
 *  flat-shaded, so the bevel was never a shading issue. */
export function buildHullSkin(triangles: readonly Triangle[] | undefined): HullSkin {
  const tris = triangles ?? [];
  const verts = tris.map(t => [0, 1, 2].map(i => absVert(t, i)));
  const edgeUses = new Map<string, number>();
  tris.forEach((_, ti) => {
    for (let i = 0; i < 3; i++) {
      const k = edgeKey(verts[ti]![i]!, verts[ti]![(i + 1) % 3]!);
      edgeUses.set(k, (edgeUses.get(k) ?? 0) + 1);
    }
  });
  const faces: HullFace[] = [];
  const wire: number[] = [];
  tris.forEach((t, ti) => {
    const all = hullPrism(t);
    // walls come in pairs per edge i→j: faces[2 + 2i], faces[3 + 2i]
    for (let f = 0; f < all.length; f++) {
      if (all[f]!.cap === 2) {
        const i = ((f - 2) / 2) | 0;
        const k = edgeKey(verts[ti]![i]!, verts[ti]![(i + 1) % 3]!);
        if ((edgeUses.get(k) ?? 0) > 1) continue;     // joined to a neighbour
      }
      faces.push(all[f]!);
    }
    const p: V3[] = ([0, 1, 2] as const).map(i => {
      const v = hullVertex(t, i);
      return [v.x, v.y, v.z];
    });
    for (let i = 0; i < 3; i++) {
      const a = p[i]!, b = p[(i + 1) % 3]!;
      wire.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
    }
  });
  return { faces, wire, tris: tris.length };
}
