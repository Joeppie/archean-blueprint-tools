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
  return cellOverlapSkip(bp, cell, size, []);
}

/** cellOverlap that IGNORES the listed block indices — MOVE validation for
 *  an EXISTING block (the v1.5 BLOCK gizmo: the destination must not collide
 *  with the mover's own old cell, nor with its ⇄ twin's not-yet-moved one). */
export function cellOverlapSkip(bp: Blueprint, cell: Cell, size: Cell, skip: number[]): boolean {
  const x1 = cell[0] + size[0] + 1, y1 = cell[1] + size[1] + 1, z1 = cell[2] + size[2] + 1;
  for (let i = 0; i < bp.data.blocks.length; i++) {
    if (skip.includes(i)) continue;
    const b = bp.data.blocks[i]!;
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

// ------------------------------------------------- IN-PLACE rotate / flip
// The block EDITOR's shape tools (v1.4 user rule: "rotate/flip in place …
// keeps the block precisely in place … correct wrongly-faced blocks"). The
// shape table lives on the UNIT box, so a ±90° turn about a world axis is
// just the vertex cloud rotated about the box centre and looked back up in
// the table; the block's footprint EXCHANGES the two axes perpendicular to
// the spin axis and its start cell shifts by HALF the extent difference so
// the bbox centre stays put (a half-cell round-up when the difference is
// odd — the lattice cannot hold the exact centre then).

const cloudKey = (pts: [number, number, number][]) =>
  pts.map(p => p.map(v => Math.round(v * 1000)).join(',')).sort().join(';');

/** cloud → type over the whole shape table (0..52) — built once, the same
 *  cloud source MIRROR_TYPE derives from, so it can never drift. */
const CLOUD_TYPE: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (let t = 0; t <= 52; t++) m.set(cloudKey(getBlockPoints(t, [0, 0, 0], [1, 1, 1])), t);
  return m;
})();

/** The type of the unit-box shape turned ±90° about a world axis (cw=false
 *  = +90° right-hand about the axis). Falls back to t when the rotated
 *  cloud is not in the table (proper rotations of table shapes always are,
 *  so this only guards against a future table gap). */
export function rotateTypeAbout(t: number, axis: 'x' | 'y' | 'z', cw: boolean): number {
  const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const b = (a + 1) % 3, c = (a + 2) % 3;          // c = R_+90(a)·b
  const s = cw ? -1 : 1;                            // ±90°
  const pts = getBlockPoints(t, [0, 0, 0], [1, 1, 1])
    .map(p => {
      const u: [number, number, number] = [p[0] - 0.5, p[1] - 0.5, p[2] - 0.5];
      const r: [number, number, number] = [0, 0, 0];
      r[a] = u[a]; r[b] = -s * u[c]; r[c] = s * u[b];
      return [r[0] + 0.5, r[1] + 0.5, r[2] + 0.5] as [number, number, number];
    });
  return CLOUD_TYPE.get(cloudKey(pts)) ?? t;
}

/** The block turned ±90° about a world axis IN PLACE: type rotated, the two
 *  perpendicular footprints exchanged, start cells centred on the old ones.
 *  Pure — returns a NEW block, the caller writes bp + doc. */
export function rotatedBlock(b: Block, axis: 'x' | 'y' | 'z', cw: boolean): Block {
  const a = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const b1 = (a + 1) % 3, c1 = (a + 2) % 3;
  const cell: Cell = [0, 1, 2].map(ax => blockCells(b)[(['x', 'y', 'z'] as const)[ax]!]) as Cell;
  const ext: Cell = [b.size_x + 1, b.size_y + 1, b.size_z + 1];
  const nExt: Cell = [...ext];
  nExt[b1] = ext[c1]; nExt[c1] = ext[b1];
  const nCell: Cell = [...cell];
  nCell[b1] = cell[b1]! + Math.round((ext[b1]! - nExt[b1]!) / 2);
  nCell[c1] = cell[c1]! + Math.round((ext[c1]! - nExt[c1]!) / 2);
  const nb = blockFromCell(nCell, [nExt[0]! - 1, nExt[1]! - 1, nExt[2]! - 1],
    rotateTypeAbout(b.type, axis, cw), b.colors?.[0] ?? 0);
  nb.colors = Array.isArray(b.colors) ? [...b.colors] : nb.colors;
  nb.material = b.material;
  return nb;
}

/** The block's shape MIRRORED in x but NOT moved: same cell, same size, the
 *  mirrored type (⇄ in place — the fix for a wrongly-faced block; the ⇄
 *  TWIN placement keeps using mirroredBlock, which also moves the cell). */
export function flippedBlock(b: Block): Block {
  return { ...b, colors: Array.isArray(b.colors) ? [...b.colors] : b.colors,
    type: MIRROR_TYPE[b.type] ?? b.type };
}

/** Write cell/size/type back onto a live block (frame re-anchored, the same
 *  rule blockFromCell/normalize keep: content in the minimal frames). */
export function setBlockGeom(b: Block, cell: Cell, size: Cell, type: number): void {
  const fr = (a: number) => floorDiv(a, CELLS_PER_FRAME);
  b.frame_x = fr(cell[0]); b.pos_x = cell[0] - fr(cell[0]) * CELLS_PER_FRAME;
  b.frame_y = fr(cell[1]); b.pos_y = cell[1] - fr(cell[1]) * CELLS_PER_FRAME;
  b.frame_z = fr(cell[2]); b.pos_z = cell[2] - fr(cell[2]) * CELLS_PER_FRAME;
  b.size_x = Math.max(0, size[0]); b.size_y = Math.max(0, size[1]); b.size_z = Math.max(0, size[2]);
  b.type = type;
}

// ------------------------------------------------------ SIMILAR BLOCKS ⇄
/** The block's MIRROR-TWIN among the blocks: the block sitting on this
 *  one's x-mirrored footprint with the same extents and a compatible shape
 *  (identical type or its x-mirror — a cube pair AND a ramp/counter-ramp
 *  pair both identify). Slot match wins ties; blocks whose footprint
 *  straddles the plane have no twin (-1). This is the block analogue of
 *  sym.ts's component twin index — same plane, same mask-bit-1 geometry. */
export function blockMirrorTwin(bp: Blueprint, bi: number): number {
  const bl = bp.data.blocks;
  const b = bl[bi];
  if (!b || b.type === 255) return -1;
  const c = blockCells(b);
  const mcx = mirrorBlockCell(c.x, b.size_x);
  const want = MIRROR_TYPE[b.type] ?? b.type;
  let best = -1, bestRank = -1;
  for (let j = 0; j < bl.length; j++) {
    if (j === bi) continue;
    const o = bl[j]!;
    if (o.type === 255) continue;
    if (o.size_x !== b.size_x || o.size_y !== b.size_y || o.size_z !== b.size_z) continue;
    const cj = blockCells(o);
    if (cj.x !== mcx || cj.y !== c.y || cj.z !== c.z) continue;
    // SIMILAR = a compatible shape (identical or the x-mirror): an unrelated
    // shape on the mirrored footprint is NOT the symmetric pair
    if (o.type !== b.type && o.type !== want) continue;
    let rank = 2;
    if ((o.colors?.[0] ?? -1) === (b.colors?.[0] ?? -2)) rank++;
    if (rank > bestRank) { bestRank = rank; best = j; }
  }
  return best;
}

// ------------------------------------------------------------ SNAP ✧
/** ✧ SNAP-TO-NEIGHBOURS (v1.4, user rule): "the block tries to match the
 *  shape/geometry of its neighbours — if that converges on the same one,
 *  use it; otherwise the CONSENSUS of the neighbours".
 *
 *  Heuristic (stated deliberately, stabilise later): every block's solid is
 *  convex (the game's shapes are the bbox cut by half-spaces), so a shape
 *  candidate is sampled by inside/outside probes on the SHARED FACE with
 *  each flush neighbour block. A neighbour contact is FLUSH when the two
 *  cross-sections agree probe-for-probe (two cubes: full/full; a slope and
 *  its continuation: the same half triangle; a flush corner notch: exactly
 *  complementary solids share an equal cross-section). Score = the overlap-
 *  area-weighted mean agreement over all neighbours. The winning type is
 *  the argmax over the whole table (a cube may become the slope that fits);
 *  ties keep the CURRENT type, so an already-flush block never churns.
 *  converged = the winner is fully flush (score ≈ 1) with every neighbour. */
export interface SnapResult { type: number; score: number; converged: boolean; neighbours: number }

/** Half-space planes of a block solid spanning [0,e] (outward normals;
 *  inside(p) ⟺ every plane dot ≤ 0). Degenerate triangles (flat shapes
 *  repeat vertices) are skipped. */
function solidPlanes(type: number, e: Cell): { o: [number, number, number]; n: [number, number, number] }[] {
  const pts = getBlockPoints(type, [0, 0, 0], e);
  let cx = 0, cy = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const pc = pts.length; cx /= pc; cy /= pc; cz /= pc;
  const planes: { o: [number, number, number]; n: [number, number, number] }[] = [];
  for (const f of getBlockFaces(type)) {
    const a = pts[f[0]!]!, b = pts[f[1]!]!, c = pts[f[2]!]!;
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) continue;
    nx /= l; ny /= l; nz /= l;
    if (nx * (cx - a[0]) + ny * (cy - a[1]) + nz * (cz - a[2]) > 0) { nx = -nx; ny = -ny; nz = -nz; }
    if (planes.some(pl => Math.abs(pl.n[0] - nx) < 1e-6 && Math.abs(pl.n[1] - ny) < 1e-6 &&
      Math.abs(pl.n[2] - nz) < 1e-6 && Math.abs(pl.n[0] * (a[0] - pl.o[0]) + pl.n[1] * (a[1] - pl.o[1]) + pl.n[2] * (a[2] - pl.o[2])) < 1e-6)) continue;
    planes.push({ o: a, n: [nx, ny, nz] });
  }
  return planes;
}

const SNAP_R = 4;                                   // 4×4 probes per contact

/** The solid/outside probe grid of a shape's face at axis a side s (+1 = the
 *  far face), sampled over the PHYSICAL overlap rectangle [lo,hi] of the
 *  other axes in ABSOLUTE cell coords (cell units), converted per block. */
function faceProbes(type: number, cell: Cell, e: Cell, a: number, s: number,
  lo: [number, number], hi: [number, number]): boolean[] {
  const planes = solidPlanes(type, e);
  const b1 = (a + 1) % 3, c1 = (a + 2) % 3;
  const out: boolean[] = [];
  for (let i = 0; i < SNAP_R; i++)
    for (let j = 0; j < SNAP_R; j++) {
      const ub = lo[0] + (hi[0] - lo[0]) * (i + 0.5) / SNAP_R;
      const uc = lo[1] + (hi[1] - lo[1]) * (j + 0.5) / SNAP_R;
      const p: [number, number, number] = [0, 0, 0];
      p[a] = (s > 0 ? cell[a]! + e[a]! - 1e-4 : cell[a]! + 1e-4) - cell[a]!;   // local, inside
      p[b1] = ub - cell[b1]!;
      p[c1] = uc - cell[c1]!;
      let inside = true;
      for (const pl of planes) {
        if (pl.n[0] * (p[0] - pl.o[0]) + pl.n[1] * (p[1] - pl.o[1]) + pl.n[2] * (p[2] - pl.o[2]) > 1e-9) { inside = false; break; }
      }
      out.push(inside);
    }
  return out;
}

/** The flush neighbour blocks of a footprint: touching blocks sharing the
 *  other two axes' extent, keyed (axis, side). type-255 never counts. */
function faceNeighbours(bp: Blueprint, bi: number): { j: number; a: number; s: number }[] {
  const bl = bp.data.blocks;
  const b = bl[bi];
  if (!b || b.type === 255) return [];
  const c = [0, 1, 2].map(ax => blockCells(b)[(['x', 'y', 'z'] as const)[ax]!]) as Cell;
  const e = [b.size_x + 1, b.size_y + 1, b.size_z + 1] as Cell;
  const out: { j: number; a: number; s: number }[] = [];
  for (let j = 0; j < bl.length; j++) {
    if (j === bi) continue;
    const o = bl[j]!;
    if (o.type === 255 || o.type > 52) continue;         // occupancy / unknown shape
    const cj = [0, 1, 2].map(ax => blockCells(o)[(['x', 'y', 'z'] as const)[ax]!]) as Cell;
    const ej = [o.size_x + 1, o.size_y + 1, o.size_z + 1] as Cell;
    for (let a = 0; a < 3; a++) {
      const b1 = (a + 1) % 3, c1 = (a + 2) % 3;
      const ovB = Math.min(c[b1]! + e[b1]!, cj[b1]! + ej[b1]!) - Math.max(c[b1]!, cj[b1]!);
      const ovC = Math.min(c[c1]! + e[c1]!, cj[c1]! + ej[c1]!) - Math.max(c[c1]!, cj[c1]!);
      if (ovB <= 0 || ovC <= 0) continue;
      if (cj[a] === c[a]! + e[a]!) out.push({ j, a, s: 1 });
      else if (cj[a]! + ej[a]! === c[a]!) out.push({ j, a, s: -1 });
    }
  }
  return out;
}

export function snapBlockType(bp: Blueprint, bi: number): SnapResult | null {
  const bl = bp.data.blocks;
  const b = bl[bi];
  if (!b || b.type === 255 || b.type > 52) return null;
  const nb = faceNeighbours(bp, bi);
  if (!nb.length) return null;
  const cell = [0, 1, 2].map(ax => blockCells(b)[(['x', 'y', 'z'] as const)[ax]!]) as Cell;
  const contacts = nb.map(({ j, a, s }) => {
    const o = bl[j]!;
    const cj = [0, 1, 2].map(ax => blockCells(o)[(['x', 'y', 'z'] as const)[ax]!]) as Cell;
    const ej = [o.size_x + 1, o.size_y + 1, o.size_z + 1] as Cell;
    const b1 = (a + 1) % 3, c1 = (a + 2) % 3;
    // the shared rectangle in ABSOLUTE cell coords over the two face axes —
    // faceProbes converts it into each block's local space itself, so the
    // SAME lo/hi serve the self candidate and the fixed neighbour.
    const lo: [number, number] = [Math.max(cell[b1]!, cj[b1]!), Math.max(cell[c1]!, cj[c1]!)];
    const hi: [number, number] = [Math.min(cell[b1]! + b.size_x + 1, cj[b1]! + ej[b1]!),
      Math.min(cell[c1]! + b.size_z + 1, cj[c1]! + ej[c1]!)];
    const prof = faceProbes(o.type, cj, ej, a, -s as 1 | -1, lo, hi);
    return { a, s, prof, lo, hi, w: (hi[0] - lo[0]) * (hi[1] - lo[1]) };
  });
  const eSelf = [b.size_x + 1, b.size_y + 1, b.size_z + 1] as Cell;
  const wTot = contacts.reduce((s, c) => s + c.w, 0) || 1;
  let bestType = b.type, bestScore = -1;
  for (let t = 0; t <= 52; t++) {
    let acc = 0;
    for (const c of contacts) {
      const mine = faceProbes(t, cell, eSelf, c.a, c.s, c.lo, c.hi);
      let eq = 0;
      for (let k = 0; k < mine.length; k++) if (mine[k] === c.prof[k]) eq++;
      acc += c.w * eq / mine.length;
    }
    acc /= wTot;
    // strict improvement only: an already-flush current type keeps its seat
    if (acc > bestScore + 1e-9) { bestScore = acc; bestType = t; }
  }
  return { type: bestType, score: bestScore, converged: bestScore > 0.995, neighbours: nb.length };
}
