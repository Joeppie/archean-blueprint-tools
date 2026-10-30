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
import { CELL } from './format';
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
  const faces: HullFace[] = [
    { slot: slot(0), tri: [F[0]!, F[1]!, F[2]!] },        // front (+normal)
    { slot: slot(1), tri: [B[2]!, B[1]!, B[0]!] },        // back
  ];
  for (let i = 0; i < 3; i++) {                           // side walls, edge i→j
    const j = (i + 1) % 3;
    const s = slot(2 + i);
    faces.push({ slot: s, tri: [F[i]!, B[i]!, B[j]!] });
    faces.push({ slot: s, tri: [F[i]!, B[j]!, F[j]!] });
  }
  return faces;
}

/** whole skin: every triangle of the file → prism faces + wire edges.
 *  Every prism draws ALL its faces — caps and side walls alike; what the
 *  game does at joined edges with its compiled builder is NOT mirrored
 *  (the v1.5.10 "shared-edge wall cull / cap weld" reading was reverted
 *  same release: the user ruled the mechanic does not exist, and the ISW
 *  wingtips showed rims are what read as a solid tip). */
export function buildHullSkin(triangles: readonly Triangle[] | undefined): HullSkin {
  const faces: HullFace[] = [];
  const wire: number[] = [];
  for (const t of triangles ?? []) {
    faces.push(...hullPrism(t));
    const p: V3[] = ([0, 1, 2] as const).map(i => {
      const v = hullVertex(t, i);
      return [v.x, v.y, v.z];
    });
    for (let i = 0; i < 3; i++) {
      const a = p[i]!, b = p[(i + 1) % 3]!;
      wire.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
    }
  }
  return { faces, wire, tris: (triangles ?? []).length };
}

// ---------------------------------------------------------------------------
// v1.16.3 FLAT-SHEET DISPLAY MODE (session A/B toggle; we: "triangles are so
// problematic to render properly… render them as a flat surface, 2 sided but
// flat, so less problems with protruding edges and dashboards, toggle option
// on display as 3d — they occlude dashboards where blocks wouldnt and in
// game they dont"). DISPLAY-ONLY like the stitch below: the FILE, the pick
// law (tris.triAt reads the records) and the selection visuals stay prism
// law; the prism stays the DEFAULT. Each record renders as a sheet IN THE
// RECORDED PLANE (no ±HULL_T caps, no rim walls — the rims are the
// protruding edges, the ±0.025 m slab is what buries a coplanar dashboard):
//   colours[0] = the face at the authored winding (front normal),
//   colours[1] = the back at the reversed winding.
// Slots 2..4 (the rim paints) draw nothing — a sheet has no rim.
// ---------------------------------------------------------------------------

/** flat 2-sided sheet for one triangle file record — vertices EXACTLY at the
 *  recorded lattice positions (zero thickness), front = colours[0] verbatim
 *  winding, back = colours[1] reversed winding. */
export function hullSheet(t: Triangle): HullFace[] {
  const p: [V3, V3, V3] = ([0, 1, 2] as const).map(i => {
    const v = hullVertex(t, i);
    return [v.x, v.y, v.z] as V3;
  }) as [V3, V3, V3];
  const slot = (i: number): number => t.colors?.[i] ?? 0;
  return [
    { slot: slot(0), tri: [p[0]!, p[1]!, p[2]!] },        // front (+normal)
    { slot: slot(1), tri: [p[2]!, p[1]!, p[0]!] },        // back (reversed)
  ];
}

/** whole skin as flat sheets — same wire + record count as buildHullSkin. */
export function flatHullSkin(triangles: readonly Triangle[] | undefined): HullSkin {
  const faces: HullFace[] = [];
  const wire: number[] = [];
  for (const t of triangles ?? []) {
    faces.push(...hullSheet(t));
    const p: V3[] = ([0, 1, 2] as const).map(i => {
      const v = hullVertex(t, i);
      return [v.x, v.y, v.z];
    });
    for (let i = 0; i < 3; i++) {
      const a = p[i]!, b = p[(i + 1) % 3]!;
      wire.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
    }
  }
  return { faces, wire, tris: (triangles ?? []).length };
}

// ---------------------------------------------------------------------------
// v1.12.7 DRAW-ONLY SKIN STITCH — the fix for the hullify FPS drain (blocks
// converted to triangles multiply rendered geometry 15-116x: every stored
// record becomes an 8-face closed prism, per-cell, with no stitch pass — the
// economy blocks get from cull.ts's rectangle stitching). The FILE stays
// verbatim (per-record records are the format law, and pick/select/pins read
// the records, not the mesh); only the DISPLAY mesh merges.
//
// STITCH-LAW (deliberately narrow — provably appearance-neutral):
//  • a group = records on ONE axis-aligned lattice plane (integer vertex
//    lattice g = v + 12·frame; world = (g − 6)·CELL), same winding sign and
//    the SAME colour in all five slots (hullify's encodeTri writes exactly
//    that; authored skins like ISW's 0/4/51 chrome/glass/hull never match);
//  • only axis-aligned right-triangle records take part: pairs whose union
//    is exactly an axis-aligned rectangle — the unit-cell square pairs of
//    hullify's per-cell adjacency cut (tools cellQuad) and the N×M quad
//    pairs of its emitPoly. Everything else (slant-profile normals, lone
//    half-squares of corner blocks, balloonfin strip quads, latsphere
//    convex faces) falls through to the verbatim prism;
//  • coplanar rectangle pairs merge to one prism, complete cell squares
//    tile into maximal rectangles (greedy, deterministic), and each
//    rectangle emits 2 cap quads + 4 boundary wall quads. Interior seams
//    that vanish are EXACTLY the coincident zero-volume pairs two adjacent
//    prisms drew on top of each other (and the cap diagonals inside a
//    quad) — nothing visible is removed. PATCH-BORDER walls (between two
//    merged rectangles of one group, and the rim of every patch) are kept
//    exactly as today: the v1.5.10 rim-cull ban is untouched — this stitch
//    never removes a boundary rim, only zero-volume interior duplicates.
// ---------------------------------------------------------------------------

type G3 = [number, number, number];

interface StitRec {
  g: [G3, G3, G3];
  axis: number;          // plane normal axis (0=x,1=y,2=z)
  sign: number;          // winding sign along it (+1 / −1)
  off: number;           // integer lattice plane offset g[axis]
  slot: number;          // the ONE colour of all five slots
  uv: [[number, number], [number, number], [number, number]];
}

/** integer lattice vertices + plane key, or null = not stitch-eligible. */
const AXN = ['x', 'y', 'z'] as const;
function stitRecord(t: Triangle): StitRec | null {
  const o = t as unknown as Record<string, number | undefined>;
  const g = [0, 1, 2].map(i => [0, 1, 2].map(ax =>
    (o[`v${i}_${AXN[ax]}`] ?? 0) + 12 * (o[`frame_${AXN[ax]}`] ?? 0)) as G3) as [G3, G3, G3];
  if (!g.every(v => v.every(x => Number.isInteger(x)))) return null;
  const e1 = [g[1]![0] - g[0]![0], g[1]![1] - g[0]![1], g[1]![2] - g[0]![2]];
  const e2 = [g[2]![0] - g[0]![0], g[2]![1] - g[0]![1], g[2]![2] - g[0]![2]];
  const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const nz = [0, 1, 2].filter(a => n[a] !== 0);
  if (nz.length !== 1) return null;                    // slant / diagonal normal — raw
  const axis = nz[0]!;
  const slots = [0, 1, 2, 3, 4].map(i => t.colors?.[i] ?? 0);
  if (slots.some(s => s !== slots[0]!)) return null;   // per-face paint — raw
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  return {
    g, axis, sign: n[axis]! > 0 ? 1 : -1, off: g[0]![axis]!, slot: slots[0]!,
    uv: g.map(p => [p[u]!, p[v]!] as [number, number]) as StitRec['uv'],
  };
}

interface StitQuad {
  u0: number; v0: number; u1: number; v1: number;   // in-plane bbox (cells)
  ra: [number, number];                              // right-angle corner
}

/** the record is an axis-aligned right triangle whose legs span its bbox
 *  exactly (area = bbox/2) — the halves of a rectangle pair. */
function stitQuad(r: StitRec): StitQuad | null {
  const [a, b, c] = r.uv;
  let ra: [number, number] | null = null;
  const tri: [[number, number], [number, number], [number, number]] = [a, b, c];
  for (let i = 0; i < 3; i++) {
    const p = tri[i]!, q = tri[(i + 1) % 3]!, s = tri[(i + 2) % 3]!;
    const d1: [number, number] = [q[0] - p[0], q[1] - p[1]];
    const d2: [number, number] = [s[0] - p[0], s[1] - p[1]];
    const axisAligned = (d1[0] === 0 || d1[1] === 0) && (d2[0] === 0 || d2[1] === 0);
    const dot = d1[0] * d2[0] + d1[1] * d2[1];
    const nonZero = (d1[0] !== 0 || d1[1] !== 0) && (d2[0] !== 0 || d2[1] !== 0);
    if (axisAligned && dot === 0 && nonZero) { ra = [p[0], p[1]]; break; }
  }
  if (!ra) return null;
  const u0 = Math.min(a[0], b[0], c[0]), u1 = Math.max(a[0], b[0], c[0]);
  const v0 = Math.min(a[1], b[1], c[1]), v1 = Math.max(a[1], b[1], c[1]);
  const w = u1 - u0, h = v1 - v0;
  if (w <= 0 || h <= 0) return null;
  const e1 = [r.g[1]![0] - r.g[0]![0], r.g[1]![1] - r.g[0]![1], r.g[1]![2] - r.g[0]![2]];
  const e2 = [r.g[2]![0] - r.g[0]![0], r.g[2]![1] - r.g[0]![1], r.g[2]![2] - r.g[0]![2]];
  const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  if (Math.abs(n[r.axis]!) !== w * h) return null;     // area must be bbox/2
  return { u0, v0, u1, v1, ra };
}

/** two right-triangle halves whose right angles sit at OPPOSITE bbox
 *  corners share the diagonal — their union is exactly the bbox (each
 *  leg pair spans the bbox by the area test in stitQuad). */
function rectPair(a: StitQuad, b: StitQuad): boolean {
  if (a.u0 !== b.u0 || a.v0 !== b.v0 || a.u1 !== b.u1 || a.v1 !== b.v1) return false;
  return (a.ra[0] !== b.ra[0]) && (a.ra[1] !== b.ra[1]);
}

/** one merged slab: caps at ±HULL_T along the (signed) plane normal, four
 *  boundary walls in the hullPrism edge convention [F_i,B_i,B_j]+[F_i,B_j,F_j]. */
function emitRect(faces: HullFace[], axis: number, sign: number, off: number,
  u0: number, v0: number, u1: number, v1: number, slot: number): void {
  const wm = (g: number): number => (g - 6) * CELL;
  const u = (axis + 1) % 3, v = (axis + 2) % 3;
  let loop: [number, number][] = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  if (sign < 0) loop = [loop[3]!, loop[2]!, loop[1]!, loop[0]!];   // CCW about the FRONT normal
  const corner = (uu: number, vv: number, s: number): V3 => {
    const p: [number, number, number] = [0, 0, 0];
    p[axis] = wm(off) + HULL_T * sign * s;
    p[u] = wm(uu); p[v] = wm(vv);
    return p;
  };
  const F = loop.map(([uu, vv]) => corner(uu, vv, 1));
  const B = loop.map(([uu, vv]) => corner(uu, vv, -1));
  faces.push(
    { slot, tri: [F[0]!, F[1]!, F[2]!] }, { slot, tri: [F[0]!, F[2]!, F[3]!] },   // front cap
    { slot, tri: [B[2]!, B[1]!, B[0]!] }, { slot, tri: [B[3]!, B[2]!, B[0]!] },   // back cap
  );
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, s = slot;
    faces.push({ slot: s, tri: [F[i]!, B[i]!, B[j]!] }, { slot: s, tri: [F[i]!, B[j]!, F[j]!] });
  }
}

function stitchGroup(pairs: { rec: StitRec; tri: Triangle }[], faces: HullFace[]): void {
  const { axis, sign, off, slot } = pairs[0]!.rec;
  const raw = (tri: Triangle): void => { faces.push(...hullPrism(tri)); };
  const cells = new Map<string, StitQuad[]>();          // unit squares (cell cut)
  const quads = new Map<string, StitQuad[]>();          // larger rect halves (emitPoly)
  const quadTri = new Map<StitQuad, Triangle>();
  for (const { rec, tri } of pairs) {
    const q = stitQuad(rec);
    if (!q) { raw(tri); continue; }
    quadTri.set(q, tri);
    if (q.u1 - q.u0 === 1 && q.v1 - q.v0 === 1) {
      const k = `${q.u0},${q.v0}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push(q);
    } else {
      const k = `${q.u0},${q.v0},${q.u1},${q.v1}`;
      (quads.get(k) ?? quads.set(k, []).get(k)!).push(q);
    }
  }
  // rectangle-pair halves (N×M quads of emitPoly — isolated block faces)
  for (const list of quads.values()) {
    if (list.length === 2 && rectPair(list[0]!, list[1]!)) {
      const q = list[0]!;
      emitRect(faces, axis, sign, off, q.u0, q.v0, q.u1, q.v1, slot);
    } else for (const q of list) raw(quadTri.get(q)!);
  }
  // complete unit-cell squares → maximal-rectangle tiling (greedy, sorted);
  // a cell with ≠2 records is a half-painted square — its prisms stay verbatim.
  const full: { u: number; v: number }[] = [];
  for (const [k, list] of cells) {
    if (list.length === 2 && rectPair(list[0]!, list[1]!)) {
      const c = k.split(',');
      full.push({ u: Number(c[0]), v: Number(c[1]) });
    } else for (const q of list) raw(quadTri.get(q)!);
  }
  full.sort((a, b) => a.v - b.v || a.u - b.u);
  const key = (u: number, v: number): string => `${u},${v}`;
  const cs = new Set(full.map(c => key(c.u, c.v)));
  const used = new Set<string>();
  for (const c of full) {
    if (used.has(key(c.u, c.v))) continue;
    let w = 1;
    while (cs.has(key(c.u + w, c.v)) && !used.has(key(c.u + w, c.v))) w++;
    let h = 1;
    grow: while (true) {
      for (let x = 0; x < w; x++)
        if (!cs.has(key(c.u + x, c.v + h)) || used.has(key(c.u + x, c.v + h))) break grow;
      h++;
    }
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) used.add(key(c.u + x, c.v + y));
    emitRect(faces, axis, sign, off, c.u, c.v, c.u + w, c.v + h, slot);
  }
}

/** whole skin for the DISPLAY pass: same wire + record count as
 *  buildHullSkin; faces go through the stitch law above (interior seam
 *  duplicates of welded coplanar cell skins merge into rectangle prisms —
 *  the hullify FPS drain), everything ineligible keeps its verbatim prism. */
let skinStitchOn = true;
/** session A/B switch (Engine seam; audit app/tools/hullifypair.mjs):
 *  false = the pre-v1.12.7 verbatim-prism render, for frame-cost gauging. */
export function setSkinStitch(on: boolean): void { skinStitchOn = on; }
export function skinStitchState(): boolean { return skinStitchOn; }

/** v1.16.3 flat-sheet A/B (Engine seam + ⚙ View row): true = flatHullSkin —
 *  the stitch pass is a VOLUME optimisation, sheets have no volume, so flat
 *  mode renders per-record sheets directly (flat beats stitch). */
let skinFlatOn = false;
export function setSkinFlat(on: boolean): void { skinFlatOn = on; }
export function skinFlatState(): boolean { return skinFlatOn; }

export function stitchHullSkin(triangles: readonly Triangle[] | undefined): HullSkin {
  if (skinFlatOn) return flatHullSkin(triangles);
  if (!skinStitchOn) return buildHullSkin(triangles);
  const faces: HullFace[] = [];
  const wire: number[] = [];
  const groups = new Map<string, { rec: StitRec; tri: Triangle }[]>();
  for (const t of triangles ?? []) {
    const p: V3[] = ([0, 1, 2] as const).map(i => {
      const v = hullVertex(t, i);
      return [v.x, v.y, v.z];
    });
    for (let i = 0; i < 3; i++) {
      const a = p[i]!, b = p[(i + 1) % 3]!;
      wire.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!);
    }
    const rec = stitRecord(t);
    if (!rec) { faces.push(...hullPrism(t)); continue; }
    const k = `${rec.axis}|${rec.sign}|${rec.off}|${rec.slot}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push({ rec, tri: t });
  }
  for (const grp of groups.values()) stitchGroup(grp, faces);
  return { faces, wire, tris: (triangles ?? []).length };
}
