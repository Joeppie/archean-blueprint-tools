// blocks.ts — the BLOCKS mode model layer (pure): absolute-cell ↔ block
// conversions, placement from a picked face, safe field writes, and
// MIRRORED placement (the ⇄ twin path for blocks/parts — same plane the
// component symmetry index uses: file x = 0).
// Absolute cell = frame·12 + pos (the same keying cull.ts uses); a block at
// cell C spans [C, C+size+1). Files store pos_* ∈ 0..12 + frame_* — the
// writer keeps content in the minimal frames, same rule as normalize.

import type { Block, Blueprint } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import { getBlockFaceDirections, getBlockFaces, getBlockPoints } from './blockshapes';

type Cell = [number, number, number];   // absolute cells (x, y, z)

const floorDiv = (a: number, b: number) => Math.floor(a / b);

export const blockCells = (b: Block) => ({
  x: (b.frame_x ?? 0) * CELLS_PER_FRAME + b.pos_x,
  y: (b.frame_y ?? 0) * CELLS_PER_FRAME + b.pos_y,
  z: (b.frame_z ?? 0) * CELLS_PER_FRAME + b.pos_z,
});

/** The cell index containing a FILE-space metre coordinate. Cell c covers
 *  world [(c−6)·CELL, (c−5)·CELL) — the cell-BOUNDARY lattice every builder
 *  uses (cull.ts origin = (abs−5.5)·CELL − CELL/2, tris.ts cornerOf rounds
 *  p/CELL + 6): a 0-size block at pos 5 CENTERS at (5−5.5)·CELL, its single
 *  cell spans [(5−6)·CELL, (5−5)·CELL) about that centre. */
export const cellIndex = (v: number) => Math.floor(v / CELL + 6);

/** The block list index covering the FILE-space point, or -1. */
export function blockAt(bp: Blueprint, p: { x: number; y: number; z: number }): number {
  const cx = cellIndex(p.x), cy = cellIndex(p.y), cz = cellIndex(p.z);
  const blocks = bp.data.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]!;
    if (b.type === 255) continue;
    const c = blockCells(b);
    if (cx >= c.x && cx < c.x + b.size_x + 1
      && cy >= c.y && cy < c.y + b.size_y + 1
      && cz >= c.z && cz < c.z + b.size_z + 1) return i;
  }
  return -1;
}

/** Would a fresh block [cell, cell+size+1) collide with an existing
 *  geometry block? (type-255 occupancy mirrors never block placement; the
 *  game's ghost turns red and refuses the click — same rule.) */
export function cellOverlap(bp: Blueprint, cell: Cell, size: Cell): boolean {
  const x1 = cell[0] + size[0] + 1, y1 = cell[1] + size[1] + 1, z1 = cell[2] + size[2] + 1;
  for (const b of bp.data.blocks) {
    if (b.type === 255) continue;
    const c = blockCells(b);
    if (cell[0] < c.x + b.size_x + 1 && x1 > c.x
      && cell[1] < c.y + b.size_y + 1 && y1 > c.y
      && cell[2] < c.z + b.size_z + 1 && z1 > c.z) return true;
  }
  return false;
}

/** A fresh block occupying exactly the cell cube [cell, cell+size+1). */
export function blockFromCell(cell: Cell, size: Cell, type: number, slot: number): Block {
  const fr = (a: number) => floorDiv(a, CELLS_PER_FRAME);
  return {
    colors: [slot, slot, slot, slot, slot, slot, slot],
    frame_x: fr(cell[0]), pos_x: cell[0] - fr(cell[0]) * CELLS_PER_FRAME,
    frame_y: fr(cell[1]), pos_y: cell[1] - fr(cell[1]) * CELLS_PER_FRAME,
    frame_z: fr(cell[2]), pos_z: cell[2] - fr(cell[2]) * CELLS_PER_FRAME,
    material: 0,
    size_x: Math.max(0, size[0]), size_y: Math.max(0, size[1]), size_z: Math.max(0, size[2]),
    type,
  };
}

export interface BlockInfo {
  bi: number; cell: Cell; size: Cell; type: number; slot: number;
}

export function blockInfo(bp: Blueprint, bi: number): BlockInfo | null {
  const b = bp.data.blocks[bi];
  if (!b) return null;
  const c = blockCells(b);
  return {
    bi, cell: [c.x, c.y, c.z],
    size: [b.size_x, b.size_y, b.size_z], type: b.type,
    slot: b.colors?.[0] ?? 0,
  };
}

// ------------------------------------------------------------ MIRRORED place
// The ⇄ path for BLOCKS: the game's editor mirror builds the twin as the
// same footprint at the x-FLIPPED cell range with the shape mirrored in x
// too (ramps/corners change orientation; cubes/pyramid-centres are
// x-symmetric). The plane is file world x = 0 — exactly the plane the
// component twin index (sym.ts, mask bit 1) uses. In the cell-boundary
// lattice (cell c covers [(c−6)·CELL, (c−5)·CELL), see cellIndex) world
// x = 0 sits at cell coord 6, so [c, c+e) → [12−c−e, 12−c). EMPIRICAL:
// counting x-twin block pairs across the workshop corpus confirms the
// 12−c−e constant overwhelmingly (airliner 3309955432: 3705 twin pairs for
// it vs 592 accidental for the alternative) — the old 10−c−size (cell-space
// plane 5.5) was a pre-v0.180 corner-convention leftover that mirrored
// blocks a half cell off the true plane.

/** Mirror a block START cell of footprint extent e = size+1 (cells) in x
 *  about the FILE WORLD x = 0 plane (cell coord 6): [c, c+e) → [12−c−e, 12−c). */
export function mirrorBlockCell(cx: number, sizeX: number): number {
  return 11 - cx - sizeX;
}

/** type → its x-mirror type, derived from the vertex clouds of the real
 *  shape table (x → 1−x in local space), so it can never drift from
 *  blockshapes.ts. Types whose mirrored cloud is not in the table (none in
 *  0..52) map to themselves. Involutory by construction. */
export const MIRROR_TYPE: Uint8Array = (() => {
  const table = new Uint8Array(256);
  for (let t = 0; t < 256; t++) table[t] = t;
  const key = (pts: [number, number, number][]) =>
    pts.map(p => p.map(v => Math.round(v * 1000)).join(',')).sort().join(';');
  const set = new Map<string, number>();
  for (let t = 0; t <= 52; t++) set.set(key(getBlockPoints(t, [0, 0, 0], [1, 1, 1])), t);
  for (let t = 0; t <= 52; t++) {
    const m = getBlockPoints(t, [0, 0, 0], [1, 1, 1]).map(p => [1 - p[0], p[1], p[2]] as [number, number, number]);
    const hit = set.get(key(m));
    if (hit !== undefined) table[t] = hit;
  }
  return table;
})();

/** The ⇄ twin of a fresh block (same footprint, mirrored cell + type). */
export function mirroredBlock(b: Block): Block {
  const cx = (b.frame_x ?? 0) * CELLS_PER_FRAME + b.pos_x;
  const mc = mirrorBlockCell(cx, b.size_x);
  const fr = (a: number) => Math.floor(a / CELLS_PER_FRAME);
  const t = MIRROR_TYPE[b.type] ?? b.type;
  const twin: Block = { ...b, type: t };
  twin.frame_x = fr(mc);
  twin.pos_x = mc - fr(mc) * CELLS_PER_FRAME;
  // colours ride the block's face slots: swap the ±x face pair when the
  // slot list is the 7-face format and the twin's face count matches
  if (Array.isArray(b.colors) && b.colors.length === 7) twin.colors = [...b.colors];
  return twin;
}

/** In-place field write with guards (keeps pos_* inside 0..12 by
 *  re-anchoring the frame). */
export function setBlockField(bp: Blueprint, bi: number,
  key: 'size_x' | 'size_y' | 'size_z' | 'type' | 'slot' | 'cx' | 'cy' | 'cz', v: number): void {
  const b = bp.data.blocks[bi];
  if (!b) return;
  if (key === 'type') { b.type = Math.max(0, Math.round(v)); return; }
  if (key === 'slot') {
    const s = Math.max(0, Math.min(255, Math.round(v)));
    b.colors = [s, s, s, s, s, s, s];
    return;
  }
  if (key.startsWith('size')) {
    const ax = key.slice(5) as 'x' | 'y' | 'z';
    let n = Math.max(0, Math.min(12, Math.round(v)));
    const c = blockCells(b);
    const off = c[ax] - (b[`frame_${ax}`] ?? 0) * CELLS_PER_FRAME;   // keep the frame
    n = Math.min(n, 12 - off);                                       // pos_* stays ≤ 12
    (b as unknown as Record<string, number>)[key] = n;
    return;
  }
  // cx/cy/cz: move the block's start cell (re-frame)
  const ax = key[1] as 'x' | 'y' | 'z';
  const cell = Math.round(v);
  (b as unknown as Record<string, number>)[`frame_${ax}`] = floorDiv(cell, CELLS_PER_FRAME);
  (b as unknown as Record<string, number>)[`pos_${ax}`] = cell - floorDiv(cell, CELLS_PER_FRAME) * CELLS_PER_FRAME;
}

// ------------------------------------------------- CONTINUATION (Shift-place)
// The game's Constructor Tool (wiki §Block Modes): "Hold Shift before pressing
// left-click to COPY the block you're aiming at or logically ADD THE NEXT
// BLOCK." Against the hit face, that next block is the SAME shape+orientation
// and the SAME size, landed so the geometry continues without a seam:
//  • AXIS face hit  → the copy sits flush on that face (the full-bbox side
//    slides against its own kind: cubes stack a wall, a slope's tall back
//    face continues the ramp DOWN one step, ±x slope triangles extend the
//    ramp sideways, an inv-corner's full top copies the notch upward).
//  • SLANT face hit → the copy steps ONE FOOTPRINT along the slant plane,
//    continuing the slanted surface flush: for a unit slope that is the
//    diagonal cell
//    (up-and-back beyond the high edge, down-and-forward beyond the low
//    edge); for a size-(sx,sy,sz) block the coplanar lattice step scales
//    with each axis footprint. Which of the plane's two directions the hit
//    point lies toward picks the candidate.
// Coplanarity is exact by construction: the slant plane of a shape in local
// units is Σ mᵢ·uᵢ = κ (mᵢ ∈ {−1,0,1} the integer slant normal), and the
// step d over axis pair (a,b) satisfies Σ mᵢ dᵢ/eᵢ = mₐ(k·m_b) + m_b(−k·m_a) = 0.

export interface PlaceSpec { cell: Cell; size: Cell; type: number; slot: number }

/** Unit normal's integer sign vector (slant normals carry 2–3 nonzero
 *  ±1 components; an axis normal carries exactly one). */
const signVec = (n: Cell): Cell =>
  [n[0] > 0.2 ? 1 : n[0] < -0.2 ? -1 : 0,
   n[1] > 0.2 ? 1 : n[1] < -0.2 ? -1 : 0,
   n[2] > 0.2 ? 1 : n[2] < -0.2 ? -1 : 0] as Cell;

/** The HIT slant face's centroid in local cell coords (relative to the
 *  block's start cell). Shapes carry up to two slants (pyramid) — the one
 *  whose geometric normal matches the hit normal is the aimed-at face. */
function slantCentroidLocal(type: number, e: Cell, hitN: Cell): Cell {
  const pts = getBlockPoints(type, [0, 0, 0], e);
  const dirs = getBlockFaceDirections(type);
  const faces = getBlockFaces(type);
  let best: Cell | null = null, bestDot = 0.9;
  faces.forEach((f, fi) => {
    if (dirs[fi] !== null) return;                       // not a slant
    const a = pts[f[0]!]!, b = pts[f[1]!]!, c = pts[f[2]!]!;
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const dot = Math.abs(nx * hitN[0] + ny * hitN[1] + nz * hitN[2]);
    if (dot < bestDot) return;
    bestDot = dot;
    let x = 0, y = 0, z = 0;
    for (const vi of new Set(f)) { x += pts[vi]![0]; y += pts[vi]![1]; z += pts[vi]![2]; }
    const n = new Set(f).size;
    best = [x / n, y / n, z / n];
  });
  return best ?? [e[0] / 2, e[1] / 2, e[2] / 2];
}

/** The game's Shift "logically add the next block" against a hit face.
 *  @param info   the aimed-at block (cell/size/type/slot)
 *  @param hit    the hit point in ABSOLUTE CELL coords (cellIndex space)
 *  @param faceN  the hit face's world/unit normal (file frame == view frame) */
export function complementBlock(info: BlockInfo, hit: Cell, faceN: Cell): PlaceSpec {
  const e: Cell = [info.size[0] + 1, info.size[1] + 1, info.size[2] + 1];
  const len = Math.hypot(faceN[0], faceN[1], faceN[2]) || 1;
  const n: Cell = [faceN[0] / len, faceN[1] / len, faceN[2] / len];
  const axisIdx = [0, 1, 2].filter(a => Math.abs(n[a]!) > 0.7);
  let cell: Cell;
  if (axisIdx.length === 1) {
    // flush copy across the aimed axis-aligned face
    const a = axisIdx[0]!, s = n[a]! > 0 ? 1 : -1;
    cell = [info.cell[0], info.cell[1], info.cell[2]];
    cell[a] = s > 0 ? info.cell[a]! + e[a]! : info.cell[a]! - e[a]!;
  } else {
    // coplanar continuation step(s) along the slant plane
    const m = signVec(n);
    const nz = [0, 1, 2].filter(a => m[a] !== 0);
    const c0 = slantCentroidLocal(info.type, e, n);
    let best: Cell = [0, 0, 0], bestDot = -Infinity;
    for (let p = 0; p < nz.length; p++)
      for (let q = p + 1; q < nz.length; q++) {
        const a = nz[p]!, b = nz[q]!;
        for (const k of [1, -1]) {
          const d: Cell = [0, 0, 0];
          d[a] = k * m[b]! * e[a]!;
          d[b] = -k * m[a]! * e[b]!;
          const dot = d[0] * (hit[0] - info.cell[0] - c0[0])
            + d[1] * (hit[1] - info.cell[1] - c0[1])
            + d[2] * (hit[2] - info.cell[2] - c0[2]);
          if (dot > bestDot) { bestDot = dot; best = d; }
        }
      }
    cell = [info.cell[0] + best[0], info.cell[1] + best[1], info.cell[2] + best[2]];
  }
  // the continuation rides the aimed block's shape, size and face colour
  return { cell, size: [info.size[0], info.size[1], info.size[2]], type: info.type, slot: info.slot };
}

/** ⟲ brush rotation: cycle a shape through its ORIENTATION family exactly
 *  like the game's scroll wheel in Cube/Slope/Corner/Pyramid/InvCorner mode
 *  (cubes have one orientation, so they stay cubes). Families per FORMAT
 *  §blocks: 0 cube · 1..12 slope · 13..20 corner · 21..44 pyramid ·
 *  45..52 inverse corner. */
export function rotateType(t: number): number {
  const fams: [number, number][] = [[0, 1], [1, 12], [13, 8], [21, 24], [45, 8]];
  for (const [lo, len] of fams)
    if (t >= lo && t < lo + len) return lo + (t - lo + 1) % len;
  return 0;
}
