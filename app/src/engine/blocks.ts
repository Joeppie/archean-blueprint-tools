// blocks.ts — the BLOCKS mode model layer (pure): absolute-cell ↔ block
// conversions, placement from a picked face, safe field writes, and
// MIRRORED placement (the ⇄ twin path for blocks/parts — same plane the
// component symmetry index uses: file x = 0).
// Absolute cell = frame·12 + pos (the same keying cull.ts uses); a block at
// cell C spans [C, C+size+1). Files store pos_* ∈ 0..12 + frame_* — the
// writer keeps content in the minimal frames, same rule as normalize.

import type { Block, Blueprint } from './format';
import { CELL, CELLS_PER_FRAME } from './format';
import { getBlockPoints } from './blockshapes';

type Cell = [number, number, number];   // absolute cells (x, y, z)

const floorDiv = (a: number, b: number) => Math.floor(a / b);

export const blockCells = (b: Block) => ({
  x: (b.frame_x ?? 0) * CELLS_PER_FRAME + b.pos_x,
  y: (b.frame_y ?? 0) * CELLS_PER_FRAME + b.pos_y,
  z: (b.frame_z ?? 0) * CELLS_PER_FRAME + b.pos_z,
});

/** The block list index covering the FILE-space point, or -1. */
export function blockAt(bp: Blueprint, p: { x: number; y: number; z: number }): number {
  const cx = p.x / CELL + 5.5, cy = p.y / CELL + 5.5, cz = p.z / CELL + 5.5;
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
// same footprint at the x-FLIPPED cell range ([c, c+size+1) → [−(c+size+1),
// −c)) with the shape mirrored in x too (ramps/corners change orientation;
// cubes/pyramid-centres are x-symmetric). The plane is file x = 0 — exactly
// the plane the component twin index (sym.ts, mask bit 1) uses.

/** Mirror a block START cell of footprint extent e = size+1 (cells) in x
 *  about the FILE WORLD x = 0 plane — the same plane ⇄ uses (world =
 *  (abs−5.5)·CELL ⇒ cell-space plane at 5.5): [c, c+e) → [11−c−e, 11−c). */
export function mirrorBlockCell(cx: number, sizeX: number): number {
  return 10 - cx - sizeX;
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
