// spheroid.ts — generate a SPHEROID/ELLIPSOID out of blocks, or as a
// hull-TRIANGLE skin (v1.6 tool; v1.6.1 rewrite per the user's verdict that
// the first corner-mask matcher read "jagged … lots of indentations").
//
// THE BLOCK SHAPE — a coherent staircase, then chamfer it.
// A convex spheroid voxelised on the 0.25 m lattice IS a staircase of unit
// steps — that is the resolution the lattice allows. The first version
// matched every cell against the shape table INDEPENDENTLY (corner masks +
// volume/IoU/gradient ranking), so a wedge could land beside a flat cap and
// the mismatched seams read as indentations. v1.6.1 derives every shape from
// the VOXEL NEIGHBOURHOOD instead, so neighbours agree by construction:
//
//   S = the solid cell set — SOLID: centre inside the ellipsoid (a digital
//   solid of a convex body: sealed); SHELL: every cell the surface touches
//   (a sealed one-cell skin).
//   For each solid cell look at which of its SIX face neighbours are air:
//     • none / an opposite pair / ≥ 4 exposed ▸ CUBE — flat walls and caps;
//       the cubes then GREEDY-MERGE into the fewest big square boxes (the
//       user's "100 % filled with the least square blocks"), split at the
//       12-cell frame borders.
//     • two ADJACENT faces, the edge CONVEX (the cell diagonally across it
//       is air too) ▸ the edge of a step: a SLOPE (wedge) cuts that edge at
//       45°, oriented by the true ellipsoid gradient. When the step also
//       falls away at BOTH ridge ends (the diagonal shoulders of a round
//       hull) ▸ a PYRAMID (triangle) tapers the ridge instead.
//     • three faces (no opposite pair) = a corner of the staircase: every
//       pair-diagonal air and the body diagonal air ▸ a CORNER tetra shaves
//       the protruding corner; body diagonal solid but most pair-diagonals
//       air ▸ an INVERSE CORNER coves the recessed corner.
//     • concave edges and everything else ▸ CUBE.
//   Every chamfer fits inside its own cell and only REMOVES material from a
//   cell that already touches air, so the solid stays sealed, blocks never
//   overlap, and the staircase reads as a bevelled hull using all four
//   shape families exactly where each belongs — like in-game rounded builds.
//
// THE TRIANGLE SKIN — the zeppelin answer. Blocks cost one cell per 0.25 m
// of surface; a hull-TRIANGLE skin (FORMAT §Hull triangles — the game draws
// each triangle as a 0.05 m prism) costs one triangle per ~1 m² and goes as
// smooth as the lattice allows: an ellipsoid UV grid snapped to the exact
// vertex lattice (world = (g−6)·CELL; shared slots weld), OUTWARD winding
// (the game's own authoring convention, v1.5.12), and the smooth:1 shading
// bit — the game's sheet-hull convention (3732302108) that welds normals in
// game, which is what makes a big airship read ROUNDED.

import type { Block, Triangle } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import { blockFromCell } from './blocks';
import { getTypeRotation, SHAPE, type ShapeId } from './blockshapes';
import { MATERIAL_DENSITY } from './tools';

export interface SpheroidSpec {
  /** ellipsoid CENTRE, file world metres */
  center: [number, number, number];
  /** half-extents, file metres (≥ CELL/2; equal = a sphere, else a stretched
   *  spheroid/ellipsoid — the user's "dynamic so you can stretch it") */
  radii: [number, number, number];
  /** the game's 0..6 build material (written verbatim on every block) */
  material: number;
  /** palette slot painted on every face */
  slot: number;
  /** SOLID = 100 % filled interior; false = a one-cell block skin. (The
   *  triangle skin is a separate generator — spheroidTriangles.) */
  solid: boolean;
}

const floorDiv = (a: number, b: number) => Math.floor(a / b);
const key = (x: number, y: number, z: number) => ((x + 512) * 2048 + (y + 512)) * 2048 + (z + 512);
/** inverse of key() */
function unkey(k: number): [number, number, number] {
  const z = (k % 2048) - 512;
  const t = Math.floor(k / 2048);
  const y = (t % 2048) - 512;
  const x = Math.floor(t / 2048) - 512;
  return [x, y, z];
}

// ------------------------------------------------- shape orientation table

function shapeOf(type: number): ShapeId {
  if (type === 0) return SHAPE.CUBE;
  if (type < 13) return SHAPE.SLOPE;
  if (type < 21) return SHAPE.CORNER;
  if (type < 45) return SHAPE.PYRAMID;
  return SHAPE.INVCORNER;
}

/** One block type's cut OUTWARD unit normal (the direction the shape removes
 *  material) AFTER the type's orientation — the same ROTATIONS table
 *  blockshapes/getBlockPoints applies, so "which wedge goes where" is an
 *  exact rotation question with a table answer, never a guess. Canonical
 *  (blockshapes vertex transcription):
 *    SLOPE keeps y+z ≤ 1                → removes toward (0, 1, 1)/√2
 *    CORNER = tetra kept at (1,0,0)     → removes toward (−1, 1, 1)/√3
 *    INVCORNER = cube − tetra at (1,1,1)→ removes toward (1, 1, 1)/√3
 *    PYRAMID cuts slants (0,1,1)/√2 and (−1,1,0)/√2 → the mean names the
 *      removed side. */
const TYPE_OUT: (readonly [number, number, number] | null)[] = (() => {
  const S = Math.SQRT1_2, T = Math.sqrt(1 / 3);
  const pv: [number, number, number] = [-S, 2 * S, S];
  const pl = Math.hypot(...pv);
  const canon: Record<ShapeId, readonly [number, number, number] | null> = {
    [SHAPE.CUBE]: null,
    [SHAPE.SLOPE]: [0, S, S],
    [SHAPE.CORNER]: [-T, T, T],
    [SHAPE.PYRAMID]: [pv[0] / pl, pv[1] / pl, pv[2] / pl],
    [SHAPE.INVCORNER]: [T, T, T],
  };
  const list: (readonly [number, number, number] | null)[] = [];
  for (let type = 0; type < 53; type++) {
    const out = canon[shapeOf(type)];
    if (!out) { list.push(null); continue; }
    const m = getTypeRotation(type);
    list.push([
      m[0]! * out[0] + m[3]! * out[1] + m[6]! * out[2],
      m[1]! * out[0] + m[4]! * out[1] + m[7]! * out[2],
      m[2]! * out[0] + m[5]! * out[1] + m[8]! * out[2],
    ]);
  }
  return list;
})();

const FAMILY: Record<'slope' | 'corner' | 'pyramid' | 'invcorner', [number, number]> = {
  slope: [1, 13], corner: [13, 21], pyramid: [21, 45], invcorner: [45, 53],
};

/** The type of `family` whose cut normal best aligns with ghat (ties → the
 *  lowest type; on a mirror-symmetric solid the gradient is mirror-
 *  equivariant, so mirrored cells choose mirrored types). */
function orient(family: keyof typeof FAMILY, ghat: readonly [number, number, number]): number {
  const [lo, hi] = FAMILY[family]!;
  let best = lo, bestD = -Infinity;
  for (let t = lo; t < hi; t++) {
    const o = TYPE_OUT[t]!;
    const d = o[0] * ghat[0] + o[1] * ghat[1] + o[2] * ghat[2];
    if (d > bestD + 1e-9) { bestD = d; best = t; }
  }
  return best;
}

// ------------------------------------------------------------ the classifier

const AX = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
] as const;

/** Unit outward gradient ∝ ((p−o)/r²) at the cell centre — the true surface
 *  fall. The voxel rules choose WHICH family, the gradient picks the
 *  orientation within it. */
function gradAt(cell: [number, number, number], o: number[], r: number[]): [number, number, number] {
  const v: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++)
    v[a] = ((cell[a]! + 0.5 - 6) * CELL - o[a]!) / (r[a]! * r[a]!);
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

/** f(p) ≤ 1 form of the implicit ellipsoid at a lattice POINT g. */
const insidePt = (px: number, py: number, pz: number, o: number[], r: number[]) => {
  const t = ((px - 6) * CELL - o[0]!) / r[0]!, u = ((py - 6) * CELL - o[1]!) / r[1]!, w = ((pz - 6) * CELL - o[2]!) / r[2]!;
  return t * t + u * u + w * w <= 1;
};
const centreIn = (x: number, y: number, z: number, o: number[], r: number[]) =>
  insidePt(x + 0.5, y + 0.5, z + 0.5, o, r);

/** fraction of the cell inside the ellipsoid — a 4×4×4 sub-sample (exact to
 *  ~±0.06 cell volume, plenty to choose cube vs inverse corner vs wedge vs
 *  pyramid vs tetra). */
function fill(x: number, y: number, z: number, o: number[], r: number[]): number {
  let n = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let k = 0; k < 4; k++)
        if (insidePt(x + (i + 0.5) / 4, y + (j + 0.5) / 4, z + (k + 0.5) / 4, o, r)) n++;
  return n / 64;
}

/** does the surface CLIP this cell (boundary only)? some corner or face
 *  centre inside AND at least one corner outside — a cell whose eight
 *  corners are all inside is BURIED (deep interior), never shell. */
function touches(x: number, y: number, z: number, o: number[], r: number[]): boolean {
  let cin = 0;
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const)
    if (insidePt(x + dx, y + dy, z + dz, o, r)) cin++;
  if (cin === 8) return false;                        // buried: no surface here
  if (cin > 0) return true;                           // mixed corners: clipped
  for (const [dx, dy, dz] of [[0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5], [0.5, 0.5, 0.5]] as const)
    if (insidePt(x + dx, y + dy, z + dz, o, r)) return true;   // tangent dip
  return false;
}

/** The chamfer rule. air = the cell's exposed face directions (1..3, no
 *  opposite pair — the caller screens those), solidAt = neighbour lookup,
 *  ghat = true surface normal, fill = the cell's inside fraction.
 *  Returns the block TYPE (0 = keep the CUBE). The fraction picks how much
 *  to remove (cube → inverse corner → slope/pyramid → corner tetra), the
 *  faces + gradient pick which piece and which way it cuts:
 *    • two faces, convex edge: a SLOPE chamfers it; where the surface also
 *      falls along the ridge axis the wedge would leave a wind-cut shoulder,
 *      so a PYRAMID tapers it; a nearly-full cell keeps its CUBE (overfill
 *      reads as a bump, the slope's underfill would read as an indentation).
 *    • three faces: a recessed corner (body diagonal solid) is COVED with
 *      an inverse corner; a protruding one shaves by fill: inverse corner,
 *      tapered pyramid, or the corner tetra for the last tip lump.
 *  Concave edges and everything else keep the CUBE. */
export function classify(
  air: readonly (readonly [number, number, number])[],
  solidAt: (dx: number, dy: number, dz: number) => boolean,
  ghat: readonly [number, number, number],
  fill = 0.5,
): number {
  if (air.length !== 2 && air.length !== 3) return 0;   // flat / thin tip: cube
  {
    const l = Math.hypot(ghat[0], ghat[1], ghat[2]) || 1;
    ghat = [ghat[0] / l, ghat[1] / l, ghat[2] / l];
  }
  if (air.length === 2) {
    const [a, b] = air as [readonly [number, number, number], readonly [number, number, number]];
    if (solidAt(a[0] + b[0], a[1] + b[1], a[2] + b[2])) return 0;   // concave edge: flat
    if (fill >= 0.75) return 0;                                      // nearly full: keep the bump
    // ridge axis = the third axis; a shoulder that also falls along it wants
    // the tapering PYRAMID rather than a full-length wedge
    const ridge = [0, 1, 2].find(ax => a[ax] === 0 && b[ax] === 0)!;
    if (Math.abs(ghat[ridge]!) >= 0.35 && fill < 0.62) return orient('pyramid', ghat);
    return orient('slope', ghat);
  }
  // three exposed faces, mutually adjacent (no opposite pair survived)
  const [a, b, c] = air as unknown as [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
  const diag = (u: readonly number[], v: readonly number[]) => solidAt(u[0]! + v[0]!, u[1]! + v[1]!, u[2]! + v[2]!);
  const nAirPair = [!diag(a, b), !diag(b, c), !diag(c, a)].filter(Boolean).length;
  const body = solidAt(a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]);
  if (body && nAirPair >= 2) return orient('invcorner', ghat);   // recess: cove it
  if (fill >= 0.65) return orient('invcorner', ghat);             // shave one corner
  // the DIAGONAL staircase band: the surface falls toward one or both side
  // faces. Equal side falls (a pure diagonal step) → the tapering PYRAMID;
  // an unequal fall → a SLOPE toward the steeper side. The top axis = the
  // air face the gradient aligns with most.
  const align = air.map(d => Math.abs(ghat[0] * d[0] + ghat[1] * d[1] + ghat[2] * d[2]));
  const top = align.indexOf(Math.max(...align));
  const sides = [0, 1, 2].filter(i => i !== top);
  const s0 = Math.max(align[sides[0]!]!, 1e-6), s1 = Math.max(align[sides[1]!]!, 1e-6);
  if (Math.min(s0, s1) / Math.max(s0, s1) >= 0.5 && fill >= 0.3) return orient('pyramid', ghat);
  if (fill >= 0.28) return orient('slope', ghat);
  return orient('corner', ghat);                                  // the last tip lump
}

// ------------------------------------------------------------ the generator

/** The generation plan (exported for the pins). */
export interface SpheroidPlan {
  /** merged cube boxes in absolute cells (min corner + cell EXTENT) */
  interior: { cell: [number, number, number]; ext: [number, number, number] }[];
  /** per-cell blocks: the chamfered shapes — plus plain unit CUBES where a
   *  shell mode has no merged interior */
  boundary: { cell: [number, number, number]; type: number }[];
}

export function spheroidPlan(spec: SpheroidSpec): SpheroidPlan {
  const o = spec.center;
  const r = spec.radii.map(v => Math.max(v, CELL / 2)) as [number, number, number];
  const g0 = [0, 1, 2].map(a => Math.floor((o[a]! - r[a]!) / CELL + 6) - 1) as number[];
  const g1 = [0, 1, 2].map(a => Math.ceil((o[a]! + r[a]!) / CELL + 6) + 1) as number[];

  // the solid set: SOLID = centre-inside (sealed digital solid of a convex
  // body); SHELL = every cell the surface touches (a sealed one-cell skin).
  const solid = new Set<number>();
  for (let gz = g0[2]!; gz <= g1[2]!; gz++)
    for (let gy = g0[1]!; gy <= g1[1]!; gy++)
      for (let gx = g0[0]!; gx <= g1[0]!; gx++)
        if (spec.solid ? centreIn(gx, gy, gz, o, r) : touches(gx, gy, gz, o, r))
          solid.add(key(gx, gy, gz));
  const inS = (x: number, y: number, z: number) => solid.has(key(x, y, z));

  const plain = new Set<number>();
  const chamfer: { cell: [number, number, number]; type: number }[] = [];
  for (const k of [...solid].sort((a, b) => a - b)) {
    const [gx, gy, gz] = unkey(k);
    const air = AX.filter(d => !inS(gx + d[0], gy + d[1], gz + d[2]));
    if (!air.length) { plain.add(k); continue; }
    const hasOpp = air.some(p => air.some(q =>
      p[0] === -q[0] && p[1] === -q[1] && p[2] === -q[2]));
    if (hasOpp || air.length >= 4) { plain.add(k); continue; }
    const t = classify(air, (dx, dy, dz) => inS(gx + dx, gy + dy, gz + dz),
      gradAt([gx, gy, gz], o, r), fill(gx, gy, gz, o, r));
    if (t === 0) plain.add(k);
    else chamfer.push({ cell: [gx, gy, gz], type: t });
  }

  if (!spec.solid) {
    // a shell has no merged interior: its plain pool cells ARE unit skin
    // blocks (the inside faces read flat by construction)
    for (const k of [...plain].sort((a, b) => a - b)) {
      const [x, y, z] = unkey(k);
      chamfer.push({ cell: [x, y, z], type: 0 });
    }
    return { interior: [], boundary: chamfer };
  }
  return { interior: mergeBoxes(plain), boundary: chamfer };
}

/** GREEDY 3D merge: x-runs → rectangles (y) → slabs (z), deterministic. */
function mergeBoxes(cells: Set<number>): SpheroidPlan['interior'] {
  const left = new Set(cells);
  const boxes: SpheroidPlan['interior'] = [];
  for (const k of [...cells].sort((a, b) => a - b)) {
    if (!left.has(k)) continue;
    const c = unkey(k);
    let ex = 1;
    while (left.has(key(c[0]! + ex, c[1]!, c[2]!))) ex++;
    let ey = 1;
    outer: while (true) {
      for (let x = 0; x < ex; x++)
        if (!left.has(key(c[0]! + x, c[1]! + ey, c[2]!))) break outer;
      ey++;
    }
    let ez = 1;
    outerZ: while (true) {
      for (let y = 0; y < ey; y++)
        for (let x = 0; x < ex; x++)
          if (!left.has(key(c[0]! + x, c[1]! + y, c[2]! + ez))) break outerZ;
      ez++;
    }
    for (let z = 0; z < ez; z++)
      for (let y = 0; y < ey; y++)
        for (let x = 0; x < ex; x++) left.delete(key(c[0]! + x, c[1]! + y, c[2]! + z));
    boxes.push({ cell: [c[0]!, c[1]!, c[2]!], ext: [ex, ey, ez] });
  }
  return boxes;
}

/** Split one merged box at the 12-cell frame borders (pos_* ∈ 0..11). */
function* frameChunks(box: SpheroidPlan['interior'][number]): Generator<[number, number, number, number, number, number]> {
  const split = (s: number, e: number): [number, number][] => {
    const parts: [number, number][] = [];
    let a = s;
    while (a < e) {
      const b = Math.min(e, (floorDiv(a, CELLS_PER_FRAME) + 1) * CELLS_PER_FRAME);
      parts.push([a, b]);
      a = b;
    }
    return parts;
  };
  for (const [x0, x1] of split(box.cell[0]!, box.cell[0]! + box.ext[0]!))
    for (const [y0, y1] of split(box.cell[1]!, box.cell[1]! + box.ext[1]!))
      for (const [z0, z1] of split(box.cell[2]!, box.cell[2]! + box.ext[2]!))
        yield [x0, y0, z0, x1 - x0, y1 - y0, z1 - z0];
}

/** THE block generator: every Block record of the spheroid (interior boxes
 *  first, then the chamfered skin, deterministic; frame-legal). */
export function spheroidBlocks(spec: SpheroidSpec): Block[] {
  const plan = spheroidPlan(spec);
  const out: Block[] = [];
  const boxes = plan.interior
    .slice()
    .sort((a, b) => a.cell[2]! - b.cell[2]! || a.cell[1]! - b.cell[1]! || a.cell[0]! - b.cell[0]!);
  for (const box of boxes)
    for (const [x, y, z, ex, ey, ez] of frameChunks(box))
      out.push(blockFromCell([x, y, z], [ex - 1, ey - 1, ez - 1], 0, spec.slot, spec.material));
  const bnd = plan.boundary
    .slice()
    .sort((a, b) => a.cell[2]! - b.cell[2]! || a.cell[1]! - b.cell[1]! || a.cell[0]! - b.cell[0]!);
  for (const b of bnd)
    out.push(blockFromCell(b.cell, [0, 0, 0], b.type, spec.slot, spec.material));
  return out;
}

// ----------------------------------------------------------- triangle skin

export interface SpheroidSkinOptions {
  /** target mesh edge length (m) the ring/segment counts aim for; 1 m keeps
   *  the chord sagitta a fraction of a cell on anything but tiny caps */
  chord?: number;
  /** the game's per-triangle shading: 'smooth' writes smooth:1 (the sheet-
   *  hull convention that welds normals in game — the ROUND look), 'flat'
   *  omits the key (faceted, the game's fresh-authoring style) */
  shade?: 'smooth' | 'flat';
}

/** the UV grid sizes for a spheroid skin at the target chord. The parameter
 *  turns about the Y axis (rings stack in y, poles at ±ry), so the RINGS
 *  count the dominant meridional ARC (Ramanujan perimeter of the widest
 *  profile ellipse (max(rx,rz), ry) — a stretched side ellipsoid would be
 *  starved of rings by parametric spacing) and the SEGMENTS the widest
 *  ring's perimeter P(rx,rz). */
export function spheroidSkinGrid(spec: SpheroidSpec, chord = 0.5): { rings: number; segs: number } {
  const [rx, ry, rz] = spec.radii;
  const perim = (a: number, b: number) =>
    Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  const meridianArc = perim(Math.max(rx!, rz!), ry!) / 2;   // pole to pole
  const ringArc = perim(rx!, rz!);                          // widest ring (t = 0)
  const segs = Math.max(8, Math.min(96, Math.round(ringArc / Math.max(chord, CELL))));
  const rings = Math.max(4, Math.min(48, Math.round(meridianArc / Math.max(chord, CELL))));
  return { rings, segs };
}

/** THE triangle-skin generator: a watertight ellipsoid of hull triangles.
 *  Vertices are snapped to the exact lattice g (world = (g−6)·CELL, shared
 *  slots weld), the winding is OUTWARD (normal · (centroid − centre) ≥ 0),
 *  degeneracies collapsed by the snap are skipped, and records carry the
 *  game's INT lattice encoding (per-axis frame + 0..31 vertex window, five
 *  colour faces on the paint slot) — hullify's encodeTri rules. */
export function spheroidTriangles(spec: SpheroidSpec, opts: SpheroidSkinOptions = {}): Triangle[] {
  const o = spec.center;
  const r = spec.radii.map(v => Math.max(v, CELL / 2)) as [number, number, number];
  const { rings, segs } = spheroidSkinGrid(spec, opts.chord ?? 0.5);
  const shade = opts.shade ?? 'smooth';

  const snap = (p: readonly [number, number, number]): [number, number, number] =>
    [Math.round(p[0] / CELL + 6), Math.round(p[1] / CELL + 6), Math.round(p[2] / CELL + 6)];
  const vert = (t: number, phi: number): [number, number, number] => {
    const s = Math.sqrt(Math.max(0, 1 - t * t));
    return snap([o[0]! + r[0]! * s * Math.cos(phi), o[1]! + r[1]! * t, o[2]! + r[2]! * s * Math.sin(phi)]);
  };

  const tris: Triangle[] = [];
  const seen = new Set<string>();
  const push = (gA: [number, number, number], gB: [number, number, number], gC: [number, number, number]) => {
    const eq = (p: number[], q: number[]) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];
    if (eq(gA, gB) || eq(gB, gC) || eq(gA, gC)) return;
    // OUTWARD winding: flip unless (B−A)×(C−A) points away from the centre
    const ux = gB[0] - gA[0], uy = gB[1] - gA[1], uz = gB[2] - gA[2];
    const wx = gC[0] - gA[0], wy = gC[1] - gA[1], wz = gC[2] - gA[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const mx = (gA[0] + gB[0] + gC[0]) / 3 - 6 - o[0] / CELL;
    const my = (gA[1] + gB[1] + gC[1]) / 3 - 6 - o[1] / CELL;
    const mz = (gA[2] + gB[2] + gC[2]) / 3 - 6 - o[2] / CELL;
    const [A, B, C] = nx * mx + ny * my + nz * mz < 0 ? [gA, gC, gB] : [gA, gB, gC];
    const id = `${A}:${B}:${C}`;
    if (seen.has(id)) return;
    seen.add(id);
    const t = encodeTriSkin([A, B, C], spec.slot, spec.material, shade === 'smooth');
    if (t) tris.push(t);
  };

  // ARC-EVEN ring placement: the parametric t = cos(lat) spacing is starved
  // along the LONG side of a stretched ellipsoid — sample the meridian fine
  // and invert by arc length (poles at t = ±1, ring radii follow t)
  const rs = [...r].sort((x, y) => y - x);
  const tb = r[1]!;                                  // rings stack along y
  const N = 512;
  const arc: number[] = [0];
  for (let i = 1; i <= N; i++) {
    const um = Math.PI * (i - 0.5) / N;              // meridian midpoint
    arc.push(arc[i - 1]! + Math.hypot(rs[0]! * Math.sin(um), tb * Math.cos(um)) * (Math.PI / N));
  }
  const total = arc[N]!;
  const arcFind = (target: number) => {              // arc length ▸ param u/N
    let lo = 0, hi = N;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arc[mid]! < target) lo = mid; else hi = mid; }
    const d = arc[hi]! - arc[lo]!;
    return lo + (d > 0 ? (target - arc[lo]!) / d : 0);
  };
  const ts: number[] = [];
  for (let ring = 0; ring <= rings; ring++)
    ts.push(Math.cos(Math.PI * Math.min(1, Math.max(0, arcFind(total * ring / rings) / N))));

  for (let j = 0; j < rings; j++) {
    const t0 = ts[j]!, t1 = ts[j + 1]!;
    const poleTop = j === 0;
    for (let i = 0; i < segs; i++) {
      const p0 = (2 * Math.PI * i) / segs, p1 = (2 * Math.PI * (i + 1)) / segs;
      const a = vert(t0, p0), b = vert(t0, p1), c = vert(t1, p1), d = vert(t1, p0);
      if (poleTop) push(a, c, d);                    // pole fan (a === b)
      else { push(a, b, c); push(a, c, d); }         // quad band (c === d at the south pole)
    }
  }
  return tris;
}

/** Store a lattice triangle exactly like hullify's encodeTri (the game's
 *  frame + 0..31 vertex window, five colour faces on one slot; smooth:1 =
 *  the sheet-hull shading convention). null = span > 31 cells. */
export function encodeTriSkin(
  g: [[number, number, number], [number, number, number], [number, number, number]],
  slot: number, material: number, smooth: boolean,
): Triangle | null {
  const t = smooth
    ? { colors: [slot, slot, slot, slot, slot], material, smooth: 1 }
    : { colors: [slot, slot, slot, slot, slot], material };
  const rec = t as unknown as Record<string, number>;
  for (const ax of [0, 1, 2]) {
    const name = 'xyz'[ax]!;
    const min = Math.min(g[0]![ax]!, g[1]![ax]!, g[2]![ax]!);
    const f = floorDiv(min, CELLS_PER_FRAME);
    rec[`frame_${name}`] = f;
    for (let i = 0; i < 3; i++) {
      const v = g[i]![ax]! - CELLS_PER_FRAME * f;
      if (v < 0 || v > 31) return null;              // too wide for the 5-bit window
      rec[`v${i}_${name}`] = v;
    }
  }
  return t as unknown as Triangle;
}

// ------------------------------------------------------------------ stats

const VOLUME: Record<ShapeId, number> = {
  [SHAPE.CUBE]: 1, [SHAPE.SLOPE]: 0.5, [SHAPE.CORNER]: 1 / 6,
  [SHAPE.PYRAMID]: 1 / 3, [SHAPE.INVCORNER]: 5 / 6,
};

/** ellipsoid surface area, metres² (Knud Thomsen's approximation) */
export function skinArea(spec: SpheroidSpec): number {
  const [a, b, c] = spec.radii;
  const p = 1.7892;
  return 4 * Math.PI * (((a! * b!) ** p + (b! * c!) ** p + (c! * a!) ** p) / 3) ** (1 / p);
}

/** live dialog readout numbers. BLOCKS: block count + kg = the FILLED cell
 *  volume × the material's per-cell-cube density. SKIN: triangle count +
 *  kg = surface area × the 0.05 m prism × the volumetric density. */
export function spheroidStats(spec: SpheroidSpec, opts: SpheroidSkinOptions = {}): {
  blocks: number; interiorCells: number; shellCells: number; tris: number;
  kgBlocks: number; kgSkin: number;
} {
  const dens = MATERIAL_DENSITY[spec.material] ?? MATERIAL_DENSITY[0]!;
  const plan = spheroidPlan(spec);
  let cells = 0, boxes = 0;
  for (const b of plan.interior) {
    cells += b.ext[0]! * b.ext[1]! * b.ext[2]!;
    for (const _ of frameChunks(b)) boxes++;
  }
  let filled = cells;
  for (const b of plan.boundary) filled += b.type === 0 ? 1 : VOLUME[shapeOf(b.type)];
  const skin = spheroidTriangles(spec, opts);
  return {
    blocks: spec.solid ? boxes + plan.boundary.length : plan.boundary.length,
    interiorCells: cells,
    shellCells: plan.boundary.length,
    tris: skin.length,
    kgBlocks: filled * dens,
    kgSkin: skinArea(spec) * 0.05 * dens / (CELL * CELL * CELL),
  };
}

// --------------------------------------------------------------- overlaps

/** does the generated block set collide with an EXISTING blueprint? (the
 *  ghost goes red and Build is refused — the constructor-ghost contract;
 *  a TRIANGLE skin never collides — skins overlap blocks by design) */
export function spheroidOverlaps(spec: SpheroidSpec, blocks: Block[]): boolean {
  const occ = (b: Block) => ({
    x: (b.frame_x ?? 0) * CELLS_PER_FRAME + b.pos_x,
    y: (b.frame_y ?? 0) * CELLS_PER_FRAME + b.pos_y,
    z: (b.frame_z ?? 0) * CELLS_PER_FRAME + b.pos_z,
  });
  const existing = blocks.filter(b => b.type !== 255).map(b => {
    const c = occ(b);
    return [c.x, c.y, c.z, c.x + b.size_x + 1, c.y + b.size_y + 1, c.z + b.size_z + 1] as const;
  });
  const hits = (lo: number[], hi: number[]) =>
    existing.some(e => lo[0]! < e[3]! && hi[0]! > e[0]! && lo[1]! < e[4]! && hi[1]! > e[1]! && lo[2]! < e[5]! && hi[2]! > e[2]!);
  for (const b of spheroidBlocks(spec)) {
    const c = occ(b);
    if (hits([c.x, c.y, c.z], [c.x + b.size_x + 1, c.y + b.size_y + 1, c.z + b.size_z + 1])) return true;
  }
  return false;
}
