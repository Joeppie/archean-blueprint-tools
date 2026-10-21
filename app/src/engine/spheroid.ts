// spheroid.ts — generate a SPHEROID/ELLIPSOID out of build blocks (v1.6 tool).
// Pure engine module: no THREE, no DOM — the UI (Tools ▸ Spheroid) stages a
// spec, the placement ghost rides it, Build writes the blocks through the
// established doc idiom.
//
// THE ROUNDNESS LAW — every block is chosen the way a human builder picks
// shapes off a sphere, but algorithmically exactly:
//
//  1. The lattice is the block lattice (FORMAT §blocks): cell c covers
//     [(c−6)·CELL, (c−5)·CELL), a corner is a lattice POINT g, world = (g−6)·CELL.
//  2. Each unit cell is classified by the 8-bit INSIDE MASK of its corners
//     under the implicit ellipsoid f(p) = Σ((p−o)/r)² − 1 (f ≤ 0 inside).
//     A cut plane through cell corners is EXACTLY what a shape block models,
//     so the corner mask — marching-cubes style — decides the shape:
//       all 8 in  ▸ interior (a cube, later MERGED into big boxes — the
//                 user's "solid = 100% filled with the least square blocks")
//       7 in     ▸ inverse corner (the cube minus the one-out corner tetra)
//       6 in     ▸ slope (the two out corners share an edge ⟺ an exact
//                  diagonal cut); non-adjacent pairs fall back to inv-corner
//       5 in     ▸ pyramid (exact) / slope (fallback)
//       4 in     ▸ the flat band where the surface crosses an axis face:
//                  slope where it can tilt WITH the gradient (the band is
//                  genuinely sloped), cube when the cut is truly flat
//       1–3 in   ▸ corner (the smallest lump the shape table owns)
//       0 in     ▸ nothing (a centre-inside tangent sliver becomes a cube so
//                  the shell always SEALS)
//     Candidates are ranked in TWO STAGES: an exact corner-set match first
//     (the cut passes precisely through cell corners — that shape literally
//     IS the cell's fill), ties and near-misses by volume error against the
//     corner-count estimate, then corner-set agreement (IoU), then slant-
//     normal alignment with the true ellipsoid GRADIENT at the cell centre,
//     then the lowest type id — so an exact family mask always wins, ties of
//     the same shape pick the orientation the surface actually leans toward,
//     and nothing ever "eyeballs" a shape.
//  3. SOLID: cells whose CENTRE is inside become full cubes (interior 100%
//     filled, no internal gaps); boundary cells (centre outside, ≥1 corner
//     in) get the matched shape. SHELL: only boundary cells get blocks, so
//     the spheroid is a skin of the fewest blocks overall.
//  4. Interior cubes are GREEDY-MERGED (x-runs → rectangles → slabs) into
//     the fewest boxes, then SPLIT at the 12-cell frame borders (pos_* must
//     stay ∈ 0..11 next to size_* — blockFromCell's own lattice rule).
//
// The result is mirror-symmetric about every ellipsoid axis plane when the
// centre lands on the corner lattice (the gradient tiebreak is itself
// mirror-equivariant), needs no per-craft constants, and never overlaps:
// each cell contributes at most one block.

import type { Block } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import { blockFromCell } from './blocks';
import { getBlockPoints, getTypeRotation, SHAPE, type ShapeId } from './blockshapes';
import { MATERIAL_DENSITY } from './tools';

const floorDiv = (a: number, b: number) => Math.floor(a / b);

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
  /** true = 100% filled interior (merged cube boxes); false = shell only */
  solid: boolean;
}

/** The full generation plan (exported for the vitest pins — the blocks are
 *  derived from it, and the tests score roundness/coverage on the plan). */
export interface SpheroidPlan {
  /** merged interior boxes in absolute cells (min corner + cell EXTENT) */
  interior: { cell: [number, number, number]; ext: [number, number, number] }[];
  /** boundary cells + their matched shape type (unit blocks) */
  boundary: { cell: [number, number, number]; type: number }[];
}

// ------------------------------------------------------- shape candidate table

// One candidate = one block type (0..52): which of the cell's 8 corners its
// solid touches (bit dx|2dy|4dz), its volume (cells³) and its cut's OUTWARD
// normal (the direction the shape REMOVES material — the slant face's
// normal pointing into the space it does not fill; null = no slant).
interface Candidate { type: number; mask: number; volume: number; out: [number, number, number] | null }

// Volumes verified against the shape vertex tables: corner = the unit-corner
// tetra (1/6), pyramid = the 1×1 base wedge with apex height 1 (1/3), slope =
// the half-cube diagonal cut (1/2), inv-corner = cube − tetra (5/6).
const VOLUME: Record<ShapeId, number> = {
  [SHAPE.CUBE]: 1, [SHAPE.SLOPE]: 0.5, [SHAPE.CORNER]: 1 / 6,
  [SHAPE.PYRAMID]: 1 / 3, [SHAPE.INVCORNER]: 5 / 6,
};

// Canonical OUTWARD cut normals in the [0,1]³ frame (derived from the vertex
// tables, see the blockshapes transcription):
//  SLOPE keeps y+z ≤ 1         → removes toward (0, 1, 1)/√2
//  CORNER = tetra at (1,0,0)   → removes toward (−1, 1, 1)/√3
//  INVCORNER = cube − tetra at (1,1,1) → removes toward (1, 1, 1)/√3
//  PYRAMID cuts with two slants (normals (0,1,1)/√2 and (−1,1,0)/√2 of the
//  faces through (1,1,0)) — their mean names the removed side.
const OUT: Record<ShapeId, [number, number, number] | null> = {
  [SHAPE.CUBE]: null,
  [SHAPE.SLOPE]: [0, Math.SQRT1_2, Math.SQRT1_2],
  [SHAPE.CORNER]: [-Math.sqrt(1 / 3), Math.sqrt(1 / 3), Math.sqrt(1 / 3)],
  [SHAPE.PYRAMID]: (() => {
    const a: [number, number, number] = [0, Math.SQRT1_2, Math.SQRT1_2];
    const b: [number, number, number] = [-Math.SQRT1_2, Math.SQRT1_2, 0];
    const v: [number, number, number] = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  })(),
  [SHAPE.INVCORNER]: [Math.sqrt(1 / 3), Math.sqrt(1 / 3), Math.sqrt(1 / 3)],
};

// The 24 proper rotations + the per-type rotation are exactly what the game's
// table (blockshapes TYPE_ROTATION/ROTATIONS) applies to the canonical shape,
// so the rotated CORNER SET goes through getBlockPoints with a unit box at
// the origin: a vertex coordinate is exactly 0 or 1 because the rotations are
// signed permutations about the cube centre.
const CANDIDATES: Candidate[] = (() => {
  const list: Candidate[] = [];
  for (let type = 0; type < 53; type++) {
    const pts = getBlockPoints(type, [0, 0, 0], [1, 1, 1]);
    const shape = shapeOf(type);
    let mask = 0;
    for (const [x, y, z] of pts) {
      const ix = Math.round(x), iy = Math.round(y), iz = Math.round(z);
      mask |= 1 << (ix + 2 * iy + 4 * iz);
    }
    list.push({ type, mask, volume: VOLUME[shape], out: rotateOut(type, shape) });
  }
  return list;
})();

function shapeOf(type: number): ShapeId {
  if (type === 0) return SHAPE.CUBE;
  if (type < 13) return SHAPE.SLOPE;
  if (type < 21) return SHAPE.CORNER;
  if (type < 45) return SHAPE.PYRAMID;
  return SHAPE.INVCORNER;
}

/** The canonical OUT normal through the type's OWN orientation matrix (the
 *  column-major signed permutation getBlockPoints/blockshapes share) — so a
 *  slope's slant normal points exactly where THAT type removes material. */
function rotateOut(type: number, shape: ShapeId): [number, number, number] | null {
  const out = OUT[shape];
  if (!out) return null;
  const m = getTypeRotation(type);
  return [
    m[0]! * out[0] + m[3]! * out[1] + m[6]! * out[2],
    m[1]! * out[0] + m[4]! * out[1] + m[7]! * out[2],
    m[2]! * out[0] + m[5]! * out[1] + m[8]! * out[2],
  ];
}

// ------------------------------------------------------------ cell classifier

/** f ≤ 0 test at a corner lattice point g (absolute cells). */
const cornerInside = (g: [number, number, number], o: number[], r: number[]): boolean => {
  let s = 0;
  for (let a = 0; a < 3; a++) {
    const p = (g[a]! - 6) * CELL;
    const t = (p - o[a]!) / r[a]!;
    s += t * t;
  }
  return s <= 1;
};

/** outside-mask popcount → bit index helpers */
const popcount = (m: number) => {
  let c = 0;
  for (let b = 0; b < 8; b++) if (m & (1 << b)) c++;
  return c;
};

/** Pick the best-fitting block type for one boundary cell.
 *  mask   = which of the 8 corners are INSIDE (bit dx|2dy|4dz)
 *  ghat   = unit ellipsoid gradient (outward normal) at the cell centre
 *  est    = inside-corner fraction (the cell's fill estimate)
 *  Stage 1 — an EXACT corner-set match (a shape's 8-corner mask equals the
 *  cell's mask: the cut plane passes precisely through cell corners, which is
 *  what that shape literally IS); ties fall to slant-vs-gradient alignment.
 *  Stage 2 — no shape matches exactly: rank by VOLUME error against the
 *  fill estimate, then corner-set agreement (IoU), then the same gradient
 *  alignment, then the lowest type. (IoU-primary was tried and rejected: a
 *  5-corner pyramid contains a flat 4-corner band's set and outscored the
 *  half-volume slope the band actually wants.) */
export function matchBlockType(mask: number, ghat: [number, number, number], est: number): number {
  const dot = (c: Candidate) =>
    c.out ? c.out[0] * ghat[0] + c.out[1] * ghat[1] + c.out[2] * ghat[2] : -2;
  let ex = -1, exDot = -Infinity;
  for (const c of CANDIDATES)
    if (c.mask === mask && (dot(c) > exDot + 1e-9 || (Math.abs(dot(c) - exDot) <= 1e-9 && (ex < 0 || c.type < ex)))) {
      ex = c.type; exDot = dot(c);
    }
  if (ex >= 0) return ex;
  let best = -1, bvol = Infinity, biou = -1, bdot = -Infinity;
  for (const c of CANDIDATES) {
    const vErr = Math.abs(c.volume - est);
    const inter = popcount(c.mask & mask), uni = popcount(c.mask | mask);
    const iou = uni ? inter / uni : 1;
    const d = dot(c);
    const better = vErr < bvol - 1e-9
      || (Math.abs(vErr - bvol) <= 1e-9 && (iou > biou + 1e-9
        || (Math.abs(iou - biou) <= 1e-9 && (d > bdot + 1e-9
          || (Math.abs(d - bdot) <= 1e-9 && best >= 0 && c.type < best)))));
    if (better) { best = c.type; bvol = vErr; biou = iou; bdot = d; }
  }
  return best;
}

// ------------------------------------------------------------ the generator

const key = (x: number, y: number, z: number) => ((x + 512) * 2048 + (y + 512)) * 2048 + (z + 512);

/** Build the full generation plan for a spheroid spec. */
export function spheroidPlan(spec: SpheroidSpec): SpheroidPlan {
  const o = spec.center, r = spec.radii.map(v => Math.max(v, CELL / 2)) as [number, number, number];
  const g0 = [0, 1, 2].map(a => Math.floor((o[a]! - r[a]!) / CELL + 6) - 1) as number[];
  const g1 = [0, 1, 2].map(a => Math.ceil((o[a]! + r[a]!) / CELL + 6) + 1) as number[];

  const interiorSet = new Map<number, [number, number, number]>();
  const boundary: { cell: [number, number, number]; type: number }[] = [];

  for (let gz = g0[2]!; gz <= g1[2]!; gz++)
    for (let gy = g0[1]!; gy <= g1[1]!; gy++)
      for (let gx = g0[0]!; gx <= g1[0]!; gx++) {
        let mask = 0;
        for (let b = 0; b < 8; b++) {
          const dx = b & 1, dy = (b >> 1) & 1, dz = (b >> 2) & 1;
          if (cornerInside([gx + dx, gy + dy, gz + dz], o, r)) mask |= 1 << b;
        }
        if (mask === 0) {
          // a centre-inside tangent sliver (surface between corners) must
          // still be filled, or the spheroid has a hole
          if (cornerInside([gx, gy, gz].map(v => v + 0.5) as [number, number, number], o, r))
            interiorSet.set(key(gx, gy, gz), [gx, gy, gz]);
          continue;
        }
        if (mask === 255) {
          if (spec.solid) interiorSet.set(key(gx, gy, gz), [gx, gy, gz]);
          continue;
        }
        // centre-inside mixed cell: SOLID fills it ENTIRELY (a cube) so the
        // interior has no internal skin of gaps; a SHELL keeps the matched
        // shape so the surface stays as round as the shape table allows.
        if (spec.solid && cornerInside([gx + 0.5, gy + 0.5, gz + 0.5], o, r)) {
          interiorSet.set(key(gx, gy, gz), [gx, gy, gz]);
          continue;
        }
        const ghat = gradAt([gx, gy, gz], o, r);
        boundary.push({ cell: [gx, gy, gz], type: matchBlockType(mask, ghat, popcount(mask) / 8) });
      }

  return { interior: mergeBoxes(interiorSet), boundary };
}

/** Unit outward gradient ∝ ((p−o)/r²) at the cell centre. */
function gradAt(cell: [number, number, number], o: number[], r: number[]): [number, number, number] {
  const v: [number, number, number] = [0, 0, 0];
  for (let a = 0; a < 3; a++) v[a] = ((cell[a]! + 0.5) * CELL - 6 * CELL - o[a]!) / (r[a]! * r[a]!);
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0]! / l, v[1]! / l, v[2]! / l];
}

/** GREEDY 3D merge: x-runs → rectangles (y) → slabs (z). Iteration order
 *  (x▸y▸z ascending, first unused cell seeds a box) is deterministic. */
function mergeBoxes(cells: Map<number, [number, number, number]>): SpheroidPlan['interior'] {
  const left = new Set(cells.keys());
  const boxes: SpheroidPlan['interior'] = [];
  for (const k0 of [...cells.keys()].sort((a, b) => a - b)) {
    if (!left.has(k0)) continue;
    const c = cells.get(k0)!;
    // 1) x-run
    let ex = 1;
    while (left.has(key(c[0]! + ex, c[1]!, c[2]!))) ex++;
    // 2) extend the run into y while every x-cell of the new row is free
    let ey = 1;
    outer: while (true) {
      for (let x = 0; x < ex; x++)
        if (!left.has(key(c[0]! + x, c[1]! + ey, c[2]!))) break outer;
      ey++;
    }
    // 3) extrude in z while the whole rectangle is free
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

/** THE generator: every Block record of the spheroid, in file-ready form
 *  (colors = the slot on all 7 faces, material verbatim, lattice split by
 *  blockFromCell; interior first, then the boundary shell, both deterministic
 *  by cell order). */
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

/** live dialog readout numbers: block count + a kg estimate (the game's
 *  per-cell-cube DENSITY × the shape's FILLED fraction of each cell). */
export function spheroidStats(spec: SpheroidSpec): {
  blocks: number; interiorCells: number; shellCells: number; kg: number;
} {
  const plan = spheroidPlan(spec);
  let cells = 0, boxes = 0;
  for (const b of plan.interior) {
    cells += b.ext[0]! * b.ext[1]! * b.ext[2]!;
    // the FILE-visible count is the FRAME-SPLIT one (pos_* ∈ 0..11)
    for (const _ of frameChunks(b)) boxes++;
  }
  let filled = cells;
  for (const b of plan.boundary) filled += CANDIDATES[b.type]!.volume;
  const kg = filled * (MATERIAL_DENSITY[spec.material] ?? MATERIAL_DENSITY[0]!);
  return {
    blocks: boxes + plan.boundary.length,
    interiorCells: cells, shellCells: plan.boundary.length, kg,
  };
}

/** does the generated block set collide with an EXISTING blueprint? (the
 *  ghost goes red and Build is refused — the constructor-ghost contract) */
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
    existing.some(e => lo[0]! < e[3] && hi[0]! > e[0] && lo[1]! < e[4] && hi[1]! > e[1] && lo[2]! < e[5] && hi[2]! > e[2]);
  for (const b of spheroidBlocks(spec)) {
    const c = occ(b);
    if (hits([c.x, c.y, c.z], [c.x + b.size_x + 1, c.y + b.size_y + 1, c.z + b.size_z + 1])) return true;
  }
  return false;
}
