// hull.ts — hull triangle SKIN: the game renders every hull triangle as a
// closed 0.05 m prism, NOT a flat sheet:
//   colours[0] = the cap on the authored FRONT (winding) side,
//   colours[1] = the cap on the other side,
//   colours[2..4] = the three side walls along edges v0-v1, v1-v2, v2-v0.
// All five colours matter (ISW-241 uses slots 0/4/51 = hull/glass/chrome);
// a single-triangle render reads paper-thin from the side (P2a look).
//
// EXTRUSION DIRECTION — THE PRISM BODY EXTENDS TOWARD THE SOLID SIDE
// (v1.5.15; v1.5.14's winding-relative law was still wrong for
// inward-wound skins — the user's Jimmy murals stayed hidden). Evidence
// chain, all in-game-arbitrated:
//  • The game's own authored craft (fixture 9000006001) skins triangles
//    EXACTLY coplanar over its dashboards, wound OUTWARD, and the flush
//    panels stay VISIBLE → body toward the solid = along −winding normal.
//  • Hullified Jimmy (jimminey.json, converted with the OLD inward default
//    and re-saved in game) has its mural dashboards (3 m plates) coplanar
//    at offset 0.0000 with the skin, whose winding normal points INTO the
//    wall — in game the murals are visible too → body toward the solid =
//    along +winding normal THERE. Winding therefore cannot pick the side.
//  • Symmetric ±0.025 centring (XenonViewer) buries every 0..0.02 m relief
//    → the game does not do it either.
// The solid side per triangle, best signal first:
//  1. the block hull: with geometry blocks in the file (partial skins:
//     ISW-241, airliner, testframe…) the occupied cell right behind the
//     face IS the solid;
//  2. parallel skin: a hullified craft stores NO geometry blocks — but its
//     skin is an extruded block hull, so on the SOLID side a parallel skin
//     triangle (the far side of the 0.25…0.5 m wall/floor) lies close, and
//     on the AIR side nothing does;
//  3. the majority vote of the triangles that did decide (interior
//     partitions, slants, floating panels), defaulting to the winding law
//     (outward-authored skins: every in-game-authored file, and every
//     conversion since the v1.5.12 default).
// A tiny SEAM keeps the flush cap from z-fighting a block face it rides;
// it is far below any mount's relief (flush content is 0.01..0.02 m proud).
//
// Winding (de-mirrored v0.180, FORMAT §Chirality): vertices are in the RAW
// frame == the view frame, so the FRONT normal is the ordinary winding cross
// cross(p1−p0, p2−p0) — colours[0] paints that side, matching the game's own
// front face (the old chain mirrored the vertices and flipped the winding).
// The winding still picks WHICH cap is colours[0]; it no longer picks the
// extrusion side.

import type { Block, Triangle } from './format';
import { CELL } from './format';
import { hullVertex } from './hullfit';
import { blkCell, blkSpan } from './cull';
import { OCCUPANCY_TYPE } from './blockshapes';

/** half-thickness of the hull skin (m) — legacy HULL_T. */
export const HULL_T = 0.025;

/** the flush cap rides SEAM BEHIND the triangle plane (z-fight guard vs a
 *  block face the skin rides — 0.002 m, invisible at any mount relief). */
export const HULL_SEAM = 0.002;

/** how deep to look for the far side of a wall/floor when probing parallel
 *  skin (a hullified block hull is 1…2 cells thick at any face). */
const SOLID_REACH = 0.35;
const SOLID_GAP = 0.02;   // ignore coincident/coplanar neighbours in probes

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

const sub = (a: V3, b: V3): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const cross = (a: V3, b: V3): V3 => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];
const dot = (a: V3, b: V3): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** prism faces for one triangle file record (raw frame == view frame).
 *  body = −1: the solid lies on the −(winding normal) side (outward-wound
 *  skins — the v1.5.14 law); body = +1: the SOLID lies on the winding-
 *  normal side (inward-wound legacy conversions) — the prism mirrors, the
 *  colours[0] cap stays on the winding-normal side either way. */
export function hullPrism(t: Triangle, body = -1): HullFace[] {
  const p: [V3, V3, V3] = ([0, 1, 2] as const).map(i => {
    const v = hullVertex(t, i);
    return [v.x, v.y, v.z] as V3;
  }) as [V3, V3, V3];

  // FRONT normal = cross of the authored winding (raw frame, v0.180)
  const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  const u: V3 = [n[0]! / len, n[1]! / len, n[2]! / len];
  const off = (v: V3, s: number): V3 => [v[0]! + u[0]! * s, v[1]! + u[1]! * s, v[2]! + u[2]! * s];
  // the prism straddles [tB, tF] along u: the cap on the AIR side sits at
  // −SEAM (flush with the surface), the body reaches 0.05 m toward the solid
  const tF = body < 0 ? -HULL_SEAM : HULL_SEAM + 2 * HULL_T;
  const tB = body < 0 ? -HULL_SEAM - 2 * HULL_T : HULL_SEAM;
  const F = p.map(v => off(v, tF)) as [V3, V3, V3];
  const B = p.map(v => off(v, tB)) as [V3, V3, V3];

  // outward winding for EVERY face of the convex prism: align each triangle
  // with the prism centroid (the caps' authored winding already agrees; the
  // walls flip automatically when the prism mirrors, body = +1)
  const all = [...F, ...B];
  const centre: V3 = [0, 1, 2].map(a => all.reduce((s, v) => s + v[a]!, 0) / all.length) as unknown as V3;
  const out = (a: V3, b: V3, c: V3): [V3, V3, V3] => {
    const mid: V3 = [(a[0]! + b[0]! + c[0]!) / 3, (a[1]! + b[1]! + c[1]!) / 3, (a[2]! + b[2]! + c[2]!) / 3];
    return dot(cross(sub(b, a), sub(c, a)), sub(mid, centre)) < 0 ? [a, c, b] : [a, b, c];
  };

  const slot = (i: number): number => t.colors?.[i] ?? 0;
  const faces: HullFace[] = [
    { slot: slot(0), tri: out(F[0], F[1], F[2]) },   // colours[0] cap (winding side)
    { slot: slot(1), tri: out(B[0], B[1], B[2]) },   // colours[1] cap
  ];
  for (let i = 0; i < 3; i++) {                      // side walls, edge i→j
    const j = (i + 1) % 3;
    const s = slot(2 + i);
    faces.push({ slot: s, tri: out(F[i]!, B[i]!, B[j]!) });
    faces.push({ slot: s, tri: out(F[i]!, B[j]!, F[j]!) });
  }
  return faces;
}

// --------------------------------------------------------- solid-side law

/** cell-containment key for the block probe (|cell| < 8192 = frame ±682) */
const cellKey = (x: number, y: number, z: number): number =>
  ((x + 8192) * 16384 + (y + 8192)) * 262144 + (z + 8192);
const cellOfM = (m: number): number => Math.floor(m / CELL + 6);

/** ray–triangle crossing count from a point along the SIGNED axis ê′ =
 *  sign(u·ê)·ê (Möller–Trumbore, axis ray so the cross/dots stay cheap).
 *  Casting along the winding side puts the sample's OWN face at t < 0
 *  behind the origin — excluded by construction — and parity to infinity
 *  counts the true manifold crossings of every other triangle. */
function rayCrossings(p: V3, ax: number, sgn: number, p3: readonly [V3, V3, V3][]): number {
  const r: V3 = ax === 0 ? [sgn, 0, 0] : ax === 1 ? [0, sgn, 0] : [0, 0, sgn];
  let count = 0;
  for (let ti = 0; ti < p3.length; ti++) {
    const tri = p3[ti]!;
    const e1 = sub(tri[1], tri[0]), e2 = sub(tri[2], tri[0]);
    // h = r × e2
    const h: V3 = cross(r, e2);
    const a = dot(e1, h);
    if (Math.abs(a) < 1e-12) continue;              // ray parallel to plane
    const s = sub(p, tri[0]);
    const f = 1 / a;
    const q: V3 = cross(s, e1);
    const v = f * dot(s, h); if (v < -1e-9 || v > 1 + 1e-9) continue;
    const w = f * dot(r, q); if (w < -1e-9 || v + w > 1 + 1e-9) continue;
    const t = f * dot(e2, q);                       // distance along +ê
    if (t > 1e-6) count++;
  }
  return count;
}

/** Global shell-parity vote for a file with NO geometry blocks: the point
 *  0.01 m along +winding-normal from a face centroid lies INSIDE the solid
 *  iff a ray from it crosses the (closed) skin an ODD number of times.
 *  Odd ⇒ the winding points into the solid ⇒ dir = +1. A consistent vote
 *  (≥ 80% agreement) decides the whole file — hullified conversions are
 *  uniformly wound by construction. Open skins (in-game canopies over
 *  nothing) vote inconsistently → no global call. */
function parityVote(p: readonly V3[][], u: readonly V3[], mid: readonly V3[]): { dir: 0 | 1 | -1; } {
  const n = p.length;
  if (n < 12) return { dir: 0 };
  const samples = Math.min(48, n);
  const step = Math.max(1, Math.floor(n / samples));
  let inside = 0, count = 0;
  for (let si = 0; si < n; si += step) {
    const ui = u[si]!, m = mid[si]!;
    const ab = [Math.abs(ui[0]!), Math.abs(ui[1]!), Math.abs(ui[2]!)];
    const ax = ab[0]! >= ab[1]! && ab[0]! >= ab[2]! ? 0 : ab[1]! >= ab[2]! ? 1 : 2;
    // jitter the two TRANSVERSE axes only (the sample sits 0.01 m inside
    // the wall — jittering along ê itself would push it out of the solid),
    // so the axis ray never grazes a shared edge
    const jit = (si * 0.0371 + 0.0131) % 0.018;
    const pt: V3 = [
      m[0]! + ui[0]! * 0.01 + (ax === 0 ? 0 : jit),
      m[1]! + ui[1]! * 0.01 + (ax === 1 ? 0 : jit * 0.61),
      m[2]! + ui[2]! * 0.01 + (ax === 2 ? 0 : jit * 0.37)];
    // the ray must escape OUTWARD from the shell to test containment;
    // cast along +ê from a point beyond any local wall (start past the
    // far face is wrong — containment only needs the ray to infinity from
    // P, walls crossed included: odd ⇔ P inside the solid manifold)
    const c = rayCrossings(pt, ax, (u[si]![ax]! >= 0 ? 1 : -1), p as [V3, V3, V3][]);
    inside += (c & 1) === 1 ? 1 : -1;
    count++;
  }
  if (!count) return { dir: 0 };
  const agree = Math.abs(inside) / count;
  if (agree < 0.8) return { dir: 0 };              // inconsistent = open skin
  return { dir: (inside > 0 ? 1 : -1) as 1 | -1 };
}

/** Per-triangle extrusion side: −1 = body along −(winding normal) (the
 *  solid sits behind the colours[0] side), +1 = mirrored. Signals: block
 *  hull probe, parallel-skin column probe, then the global shell-parity
 *  vote (no-blocks files), then the majority vote, then −1 (the outward-
 *  winding law). */
export function skinSolidDirs(triangles: readonly Triangle[],
  blocks: readonly Block[] | undefined): Int8Array {
  const n = triangles.length;
  const dir = new Int8Array(n);          // 0 = undecided
  if (!n) return dir;

  const p = triangles.map(t => ([0, 1, 2] as const).map(i => {
    const v = hullVertex(t, i);
    return [v.x, v.y, v.z] as V3;
  }) as [V3, V3, V3]);
  const u = p.map(q => {
    const nn = cross(sub(q[1], q[0]), sub(q[2], q[0]));
    const l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
    return [nn[0]! / l, nn[1]! / l, nn[2]! / l] as V3;
  });
  const mid = p.map(q => [0, 1, 2].map(a => (q[0][a]! + q[1][a]! + q[2][a]!) / 3) as unknown as V3);
  // dominant axis + its sign along the winding normal
  const axis = u.map(v => {
    const ab = [Math.abs(v[0]!), Math.abs(v[1]!), Math.abs(v[2]!)] as const;
    const ax = ab[0]! >= ab[1]! && ab[0]! >= ab[2]! ? 0 : ab[1]! >= ab[2]! ? 1 : 2;
    return { ax, s: (v[ax]! >= 0 ? 1 : -1) as 1 | -1 };
  });

  // 1) block hull probe
  const geo = (blocks ?? []).filter(b => b.type !== OCCUPANCY_TYPE);
  if (geo.length) {
    const occ = new Set<number>();
    for (const b of geo) {
      const c = blkCell(b), sz = blkSpan(b);
      for (let x = c[0]; x < c[0] + sz[0]; x++)
        for (let y = c[1]; y < c[1] + sz[1]; y++)
          for (let z = c[2]; z < c[2] + sz[2]; z++) occ.add(cellKey(x, y, z));
    }
    const probe = (pt: V3): boolean =>
      occ.has(cellKey(cellOfM(pt[0]!), cellOfM(pt[1]!), cellOfM(pt[2]!)));
    for (let i = 0; i < n; i++) {
      const { ax, s } = axis[i]!;
      // sample the three inset corners AND the centroid: a big in-game
      // authored patch can straddle an opening at its centroid while its
      // corners sit over solid block (Mach 6 canopy pin) — vote the probes
      const pts: [number, number, number][] = [];
      for (const q of [
        [p[i]![0][0]! * 0.8 + mid[i]![0]! * 0.2, p[i]![0][1]! * 0.8 + mid[i]![1]! * 0.2, p[i]![0][2]! * 0.8 + mid[i]![2]! * 0.2],
        [p[i]![1][0]! * 0.8 + mid[i]![0]! * 0.2, p[i]![1][1]! * 0.8 + mid[i]![1]! * 0.2, p[i]![1][2]! * 0.8 + mid[i]![2]! * 0.2],
        [p[i]![2][0]! * 0.8 + mid[i]![0]! * 0.2, p[i]![2][1]! * 0.8 + mid[i]![1]! * 0.2, p[i]![2][2]! * 0.8 + mid[i]![2]! * 0.2],
        [mid[i]![0]!, mid[i]![1]!, mid[i]![2]!],
      ] as [number, number, number][]) pts.push(q);
      let plusV = 0, minusV = 0;
      for (const q of pts) {
        const shift = (dd: number): [number, number, number] =>
          ax === 0 ? [q[0] + dd, q[1], q[2]] : ax === 1 ? [q[0], q[1] + dd, q[2]] : [q[0], q[1], q[2] + dd];
        if (probe(shift(0.06))) plusV++;
        if (probe(shift(-0.06))) minusV++;
      }
      if (plusV === minusV) continue;               // no signal here
      // solid on the +ê side ⇒ body along +ê ⇒ d·u must point +ê ⇒ d = s
      dir[i] = plusV > minusV ? (s as 1 | -1) : (-s as 1 | -1);
    }
  } else {
    // 2) no geometry blocks (hullified conversions): the GLOBAL shell-parity
    // vote decides the whole file — hullify skins are uniformly wound, and
    // parity is immune to interior clutter (a cabin mural has parallel skin
    // on both sides: density counts lie, crossings do not).
    const pv = parityVote(p, u, mid);
    if (pv.dir) { dir.fill(pv.dir); return dir; }
  }

  // 3) parallel-skin column probe for the still-undecided triangles: the
  // solid side of a hullified face has the wall's far-side skin within
  // SOLID_REACH. (Secondary signal: clutter can outvote the far face.)
  const pending = Array.prototype.some.call(dir, (v: number) => !v);
  if (pending) {
    const cols: [Map<number, number[]>, Map<number, number[]>, Map<number, number[]>] =
      [new Map(), new Map(), new Map()];
    for (let i = 0; i < n; i++) {
      const { ax } = axis[i]!;
      const u2 = [(ax + 1) % 3, (ax + 2) % 3] as const;
      const x0 = Math.floor(Math.min(p[i]![0][u2[0]]!, p[i]![1][u2[0]]!, p[i]![2][u2[0]]!) / CELL + 6);
      const x1 = Math.floor(Math.max(p[i]![0][u2[0]]!, p[i]![1][u2[0]]!, p[i]![2][u2[0]]!) / CELL + 6);
      const y0 = Math.floor(Math.min(p[i]![0][u2[1]]!, p[i]![1][u2[1]]!, p[i]![2][u2[1]]!) / CELL + 6);
      const y1 = Math.floor(Math.max(p[i]![0][u2[1]]!, p[i]![1][u2[1]]!, p[i]![2][u2[1]]!) / CELL + 6);
      const plane = mid[i]![ax]!;
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = ((x + 8192) * 16384 + (y + 8192));
          const m = cols[ax]!.get(k);
          if (m) m.push(plane); else cols[ax]!.set(k, [plane]);
        }
    }
    for (let i = 0; i < n; i++) {
      if (dir[i]!) continue;
      const { ax, s } = axis[i]!;
      const u2 = [(ax + 1) % 3, (ax + 2) % 3] as const;
      const k = ((cellOfM(mid[i]![u2[0]]!) + 8192) * 16384 + (cellOfM(mid[i]![u2[1]]!) + 8192));
      const planes = cols[ax]!.get(k);
      if (!planes) continue;
      const m = mid[i]![ax]!;
      let plus = 0, minus = 0;
      for (const pl of planes) {
        const d = pl - m;
        if (d > SOLID_GAP && d <= SOLID_REACH) plus++;
        else if (d < -SOLID_GAP && d >= -SOLID_REACH) minus++;
      }
      if (plus === minus) continue;                 // no signal here
      dir[i] = plus > minus ? (s as 1 | -1) : (-s as 1 | -1);
    }
  }

  // 3) majority vote for the undecided (interior surfaces, slants, panels
  // floating free of any wall); a file with NO signal at all keeps the
  // outward-winding law (−1) — every in-game-authored skin and every
  // conversion since the v1.5.12 default obeys it.
  let vote = 0;
  for (let i = 0; i < n; i++) vote += dir[i]!;
  const dflt = vote > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) if (!dir[i]!) dir[i] = dflt;
  return dir;
}

/** whole skin: every triangle of the file → prism faces + wire edges, the
 *  prisms extruded toward the SOLID side (see the header law).
 *  Every prism draws ALL its faces — caps and side walls alike; what the
 *  game does at joined edges with its compiled builder is NOT mirrored
 *  (the v1.5.10 "shared-edge wall cull / cap weld" reading was reverted
 *  same release: the user ruled the mechanic does not exist, and the ISW
 *  wingtips showed rims are what read as a solid tip). */
export function buildHullSkin(triangles: readonly Triangle[] | undefined,
  blocks: readonly Block[] | undefined): HullSkin {
  const tris = triangles ?? [];
  const dirs = skinSolidDirs(tris, blocks);
  const faces: HullFace[] = [];
  const wire: number[] = [];
  tris.forEach((t, i) => {
    faces.push(...hullPrism(t, dirs[i]!));
    const p: V3[] = ([0, 1, 2] as const).map(j => {
      const v = hullVertex(t, j);
      return [v.x, v.y, v.z];
    });
    for (let j = 0; j < 3; j++) {
      const a = p[j]!, b = p[(j + 1) % 3]!;
      wire.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
    }
  });
  return { faces, wire, tris: tris.length };
}
