// spheroid.ts — generate a SPHEROID/ELLIPSOID out of blocks, or as a
// hull-TRIANGLE skin (v1.6 tool; v1.6.2 ADDITIVE rewrite).
//
// THE BLOCK SHAPE — a staircase that only ever GAINS material.
// v1.6.0 matched cells against the shape table independently (indentations);
// v1.6.1 derived shapes from the voxel neighbourhood but still CUT into
// solid cells — and wherever such a cut did not end flush (corner tetras
// keeping 1/6 of a cell, wedges whose ends met plateaus, coves carved into
// walls) it left exactly the "a triangle is missing" gouges the user
// rejected: dents damage volume and aerodynamics. v1.6.2 follows the in-game
// building method, which is PROVABLY dent-free — a block placed into an AIR
// cell can never lower the surface below the existing solid:
//
//   S = the solid cell set (centre inside the ellipsoid) — pure CUBES,
//   merged into the fewest big boxes (never cut), split at frame borders.
//   Bevels are then ADDED into air cells along the surface, seated by the
//   FULL-FACE rule (every flush face of a bevel rests on a solid neighbour,
//   so no crack or cavity can open between them):
//     • an air cell touching solid on TWO ADJACENT faces (the cell above a
//       step, against the wall) → a SLOPE ramp bridging floor to wall; the
//       full-face pair (bottom + side) fixes the orientation uniquely.
//       Where the step RUN ends, a PYRAMID tapers the ramp instead — its
//       big slant is coplanar with the ramp, so the join stays flush.
//     • an air cell touching solid on THREE mutually adjacent faces (an
//       inside corner) → an INVERSE CORNER filler: its three full faces
//       seat on floor + two walls, its slant rounds the corner outward.
//     • everything else stays air.
//   The hull is therefore a cube staircase whose every step is ramped and
//   every inner corner rounded: bumpy at worst — NEVER dented. Convex
//   corners keep their cube (an overfill bump); the corner tetra stays
//   unused — it has no full face and can never seat flush.
//
// THE TRIANGLE SKIN — the smooth, huge, cheap mode (zeppelin). It carried
// the same class of bug: snapping a mesh vertex to the NEAREST lattice point
// pulled some vertices INSIDE the ellipsoid, so their facets cut in.
// Vertices now snap to the nearest lattice point that stays ON/OUTSIDE the
// surface — the skin can only ever bulge (volume-preserving outward) — and
// the facet budget is deliberately coarse-but-even (arc-even rings, ~0.75 m
// chord): fewer, calmer, flusher triangles instead of a dense noisy shell.

import type { Block, Triangle } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import { blockFromCell } from './blocks';
import { getBlockFaceDirections, isFullFace, getTypeRotation, SHAPE, type ShapeId } from './blockshapes';
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

// ------------------------------------------------- shape orientation tables

function shapeOf(type: number): ShapeId {
  if (type === 0) return SHAPE.CUBE;
  if (type < 13) return SHAPE.SLOPE;
  if (type < 21) return SHAPE.CORNER;
  if (type < 45) return SHAPE.PYRAMID;
  return SHAPE.INVCORNER;
}

/** One block type's cut OUTWARD unit normal (the direction the shape removes
 *  material) AFTER the type's orientation — the same ROTATIONS table
 *  blockshapes/getBlockPoints applies. Canonical (blockshapes transcription):
 *    SLOPE keeps y+z ≤ 1                → removes toward (0, 1, 1)/√2
 *    PYRAMID cuts slants (0,1,1)/√2 and (−1,1,0)/√2 → the mean names the
 *      removed side. INVCORNER = cube − tetra at (1,1,1) → (1,1,1)/√3. */
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

/** The type's FULL-FACE directions (faces covering a whole side of its box —
 *  blockshapes isFullFace), rotated. A bevel seats its full faces on solid
 *  neighbours; that is what makes an additive bevel flush and crack-free. */
const TYPE_FULLDIRS: readonly (readonly string[])[] = (() => {
  const list: string[][] = [];
  for (let type = 0; type < 53; type++) {
    const dirs = getBlockFaceDirections(type);
    const full: string[] = [];
    dirs.forEach((d, i) => {
      if (d && isFullFace(type, i)) full.push(`${d[0]},${d[1]},${d[2]}`);
    });
    list.push(full.sort());
  }
  return list;
})();

const dirKey = (dirs: readonly (readonly number[])[]) =>
  dirs.map(d => `${d[0]},${d[1]},${d[2]}`).sort().join('|');

/** SLOPE type by its full-face PAIR (bottom + one side; the 12 slopes cover
 *  all 12 adjacent pairs uniquely). */
const SLOPE_BY_PAIR = new Map<string, number>();
/** INVERSE CORNER type by its full-face TRIPLE (the 8 cover all corners). */
const INVCORNERS_BY_TRIPLE = new Map<string, number>();
/** PYRAMID types by their single full face (the floor it stands on). */
const PYRAMIDS_BY_FLOOR = new Map<string, number[]>();
for (let t = 1; t < 53; t++) {
  const full = TYPE_FULLDIRS[t]!;
  if (shapeOf(t) === SHAPE.SLOPE && full.length === 2) SLOPE_BY_PAIR.set(full.join('|'), t);
  if (shapeOf(t) === SHAPE.INVCORNER && full.length === 3) INVCORNERS_BY_TRIPLE.set(full.join('|'), t);
  if (shapeOf(t) === SHAPE.PYRAMID && full.length === 1) {
    const arr = PYRAMIDS_BY_FLOOR.get(full[0]!) ?? [];
    arr.push(t);
    PYRAMIDS_BY_FLOOR.set(full[0]!, arr);
  }
}

/** the type of `family` whose cut normal best aligns with ghat. */
function orientBy(family: ShapeId, ghat: readonly [number, number, number],
  candidates: readonly number[]): number {
  let best = candidates[0]!, bestD = -Infinity;
  for (const t of candidates) {
    if (shapeOf(t) !== family) continue;
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

/** Unit outward gradient ∝ ((p−o)/r²) at a cell's centre. */
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

/** does the surface CLIP this cell (boundary only)? some corner or face
 *  centre inside AND at least one corner outside (all-inside = buried). */
function touches(x: number, y: number, z: number, o: number[], r: number[]): boolean {
  let cin = 0;
  for (const [dx, dy, dz] of [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]] as const)
    if (insidePt(x + dx, y + dy, z + dz, o, r)) cin++;
  if (cin === 8) return false;
  if (cin > 0) return true;
  for (const [dx, dy, dz] of [[0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, 0, 0.5], [0.5, 1, 0.5], [0, 0.5, 0.5], [1, 0.5, 0.5], [0.5, 0.5, 0.5]] as const)
    if (insidePt(x + dx, y + dy, z + dz, o, r)) return true;
  return false;
}

/** The additive bevel rule for one AIR cell. solidAt = neighbour test, ghat
 *  = the true surface normal there. Returns the block TYPE to ADD (0 = keep
 *  the cell air). Every returned type seats its full faces on solid
 *  neighbours — flush by construction, additive by construction. */
export function bevelAt(
  solidDirs: readonly (readonly number[])[],
  ghat: readonly [number, number, number],
  runIsRamp: (side: [number, number, number]) => boolean,
): number {
  const l = Math.hypot(ghat[0], ghat[1], ghat[2]) || 1;
  const g: readonly [number, number, number] = [ghat[0] / l, ghat[1] / l, ghat[2] / l];
  const opp = solidDirs.some(p => solidDirs.some(q =>
    p[0]! === -q[0]! && p[1]! === -q[1]! && p[2]! === -q[2]!));
  if (solidDirs.length === 3 && !opp) {
    // inside corner: floor + two walls → inverse-corner filler (unique type)
    const t = INVCORNERS_BY_TRIPLE.get(dirKey(solidDirs));
    if (t !== undefined) return t;
    return 0;
  }
  if (solidDirs.length !== 2 || opp) return 0;
  // step corner (floor + wall): a ramp; taper with a pyramid where the run
  // of ramps ends along the ridge axis
  const [a, b] = solidDirs as [readonly [number, number, number], readonly [number, number, number]];
  const pairKey = [`${a[0]},${a[1]},${a[2]}`, `${b[0]},${b[1]},${b[2]}`].sort().join('|');
  const slope = SLOPE_BY_PAIR.get(pairKey);
  if (slope === undefined) return 0;
  const ridge = [0, 1, 2].find(ax => a[ax] === 0 && b[ax] === 0)!;
  const e1 = [0, 0, 0] as [number, number, number];
  e1[ridge] = 1;
  const e2 = [-e1[0]!, -e1[1]!, -e1[2]!] as [number, number, number];
  if (runIsRamp(e1) && runIsRamp(e2)) return slope;
  // a run end (or a single-cell step): the tapering PYRAMID. It stands on
  // the floor (its one full face); among those types the cut normal decides
  // which way it tapers. The floor = the solid direction least aligned with
  // the outward gradient (the wall rises ALONG the surface, the floor faces
  // against it).
  const dots = [a, b].map(d => d[0] * g[0] + d[1] * g[1] + d[2] * g[2]);
  const floorD = dots[0]! <= dots[1]! ? a : b;
  const cands = PYRAMIDS_BY_FLOOR.get(`${floorD[0]},${floorD[1]},${floorD[2]}`) ?? [];
  if (!cands.length) return slope;
  return orientBy(SHAPE.PYRAMID, g, cands);
}

// ------------------------------------------------------------ the generator

/** The generation plan (exported for the pins). */
export interface SpheroidPlan {
  /** merged cube boxes in absolute cells (min corner + cell EXTENT) */
  interior: { cell: [number, number, number]; ext: [number, number, number] }[];
  /** per-cell blocks: the additive bevels — plus plain unit CUBES where a
   *  shell mode has no merged interior */
  boundary: { cell: [number, number, number]; type: number }[];
}

export function spheroidPlan(spec: SpheroidSpec): SpheroidPlan {
  const o = spec.center;
  const r = spec.radii.map(v => Math.max(v, CELL / 2)) as [number, number, number];
  const g0 = [0, 1, 2].map(a => Math.floor((o[a]! - r[a]!) / CELL + 6) - 2) as number[];
  const g1 = [0, 1, 2].map(a => Math.ceil((o[a]! + r[a]!) / CELL + 6) + 2) as number[];

  // the solid set: SOLID = centre-inside (sealed digital solid of a convex
  // body); SHELL = every cell the surface touches (a sealed one-cell skin).
  const solid = new Set<number>();
  for (let gz = g0[2]!; gz <= g1[2]!; gz++)
    for (let gy = g0[1]!; gy <= g1[1]!; gy++)
      for (let gx = g0[0]!; gx <= g1[0]!; gx++)
        if (spec.solid ? centreIn(gx, gy, gz, o, r) : touches(gx, gy, gz, o, r))
          solid.add(key(gx, gy, gz));
  const inS = (x: number, y: number, z: number) => solid.has(key(x, y, z));

  // ---- additive bevels: walk the AIR cells hugging the surface ----------
  const bevels: { cell: [number, number, number]; type: number }[] = [];
  const solidDirsAt = (x: number, y: number, z: number) =>
    AX.filter(d => inS(x + d[0], y + d[1], z + d[2]));
  const isRampEligible = (x: number, y: number, z: number) => {
    if (inS(x, y, z)) return false;
    const sd = solidDirsAt(x, y, z);
    if (sd.length !== 2) return false;
    const opp = sd.some(p => sd.some(q => p[0] === -q[0] && p[1] === -q[1] && p[2] === -q[2]));
    return !opp;
  };
  for (let gz = g0[2]!; gz <= g1[2]!; gz++)
    for (let gy = g0[1]!; gy <= g1[1]!; gy++)
      for (let gx = g0[0]!; gx <= g1[0]!; gx++) {
        if (inS(gx, gy, gz)) continue;                 // air only — additive
        const sd = solidDirsAt(gx, gy, gz);
        if (sd.length < 2 || sd.length > 3) continue;
        const t = bevelAt(sd, gradAt([gx, gy, gz], o, r),
          (e) => isRampEligible(gx + e[0], gy + e[1], gz + e[2]));
        if (t !== 0) bevels.push({ cell: [gx, gy, gz], type: t });
      }

  // ---- the solid itself: pure cubes, merged ------------------------------
  if (!spec.solid) {
    // a shell: its (boundary) cells ARE unit skin blocks, plus the bevels
    const out: { cell: [number, number, number]; type: number }[] = [];
    for (const k of [...solid].sort((a, b) => a - b)) {
      const [x, y, z] = unkey(k);
      out.push({ cell: [x, y, z], type: 0 });
    }
    return { interior: [], boundary: [...out, ...bevels] };
  }
  return { interior: mergeBoxes(solid), boundary: bevels };
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
 *  first, then the additive bevels, deterministic; frame-legal). */
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
  /** target mesh edge length (m) the ring/segment counts aim for */
  chord?: number;
  /** the game's per-triangle shading: 'smooth' writes smooth:1 (the sheet-
   *  hull convention that welds normals in game — the ROUND look), 'flat'
   *  omits the key (faceted, the game's fresh-authoring style) */
  shade?: 'smooth' | 'flat';
}

/** the UV grid sizes for a spheroid skin at the target chord. The parameter
 *  turns about the Y axis (rings stack in y, poles at ±ry), so the RINGS
 *  count the dominant meridional ARC (Ramanujan perimeter of the widest
 *  profile ellipse) and the SEGMENTS the widest ring's perimeter — an
 *  even, deliberately calm facet budget. */
export function spheroidSkinGrid(spec: SpheroidSpec, chord = 0.75): { rings: number; segs: number } {
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
 *  Vertices lie on the exact lattice g (world = (g−6)·CELL; shared slots
 *  weld) snapped OUTWARD-BIASED — the nearest lattice point that stays
 *  on/outside the surface — so no facet ever cuts INTO the body (the v1.6.1
 *  skin dents came from nearest-point snapping pulling vertices inside).
 *  Winding is OUTWARD, degeneracies collapsed by the snap are skipped, and
 *  records carry the game's INT lattice encoding (per-axis frame + 0..31
 *  vertex window, five colour faces on the paint slot). */
export function spheroidTriangles(spec: SpheroidSpec, opts: SpheroidSkinOptions = {}): Triangle[] {
  const o = spec.center;
  const r = spec.radii.map(v => Math.max(v, CELL / 2)) as [number, number, number];
  // the facet budget deliberately grows with the craft: big clean panels on
  // an airship (the in-game hull look — the ISW airliner skin is 241 tris
  // for 30 m), finer only on small bodies where a coarse facet would read
  // as a different shape. A fixed dense chord is what made the v1.6.1 skin
  // look like a noisy shell.
  const rMean = (r[0]! + r[1]! + r[2]!) / 3;
  const chord = opts.chord ?? Math.max(1.5, rMean / 3);
  const { rings, segs } = spheroidSkinGrid(spec, chord);
  const shade = opts.shade ?? 'smooth';

  /** outward-biased lattice snap: nearest point with f(p) ≥ 1 */
  const snap = (p: readonly [number, number, number]): [number, number, number] => {
    const bx = Math.round(p[0] / CELL + 6), by = Math.round(p[1] / CELL + 6), bz = Math.round(p[2] / CELL + 6);
    let best: [number, number, number] | null = null, bestD = Infinity;
    let fb: [number, number, number] | null = null, fbD = Infinity;
    for (let ox = -1; ox <= 1; ox++)
      for (let oy = -1; oy <= 1; oy++)
        for (let oz = -1; oz <= 1; oz++) {
          const g: [number, number, number] = [bx + ox, by + oy, bz + oz];
          const d = ((g[0] - 6) * CELL - p[0]) ** 2 + ((g[1] - 6) * CELL - p[1]) ** 2 + ((g[2] - 6) * CELL - p[2]) ** 2;
          if (d < fbD) { fbD = d; fb = g; }
          if (!insidePt(g[0], g[1], g[2], o, r) && d < bestD) { bestD = d; best = g; }
        }
    return best ?? fb!;
  };
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
    const mx = (gA[0] + gB[0] + gC[0]) / 3 - 6 - o[0]! / CELL;
    const my = (gA[1] + gB[1] + gC[1]) / 3 - 6 - o[1]! / CELL;
    const mz = (gA[2] + gB[2] + gC[2]) / 3 - 6 - o[2]! / CELL;
    const [A, B, C] = nx * mx + ny * my + nz * mz < 0 ? [gA, gC, gB] : [gA, gB, gC];
    const id = `${A}:${B}:${C}`;
    if (seen.has(id)) return;
    seen.add(id);
    const t = encodeTriSkin([A, B, C], spec.slot, spec.material, shade === 'smooth');
    if (t) tris.push(t);
  };

  // ARC-EVEN ring placement (parametric t = cos(lat) is starved along the
  // long side of a stretched ellipsoid)
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
 *  volume × the material's per-cell-cube density (bevels ADD volume).
 *  SKIN: triangle count + kg = surface area × the 0.05 m prism. */
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
