// blocks.test.ts — pure BLOCKS-mode model pins: cell conversions and the
// cell-boundary lattice, ⇄ MIRRORED placement (cell mirror plane, the
// mirrored shape-type table derived from the real geometry, the twin
// builder), the game's SHIFT CONTINUATION rules (complementBlock) and the
// footprint overlap guard.
import { describe, expect, it } from 'vitest';

import { blockAt, blockCells, blockFromCell, cellIndex, cellOverlap,
  complementBlock, mirroredBlock, mirrorBlockCell, MIRROR_TYPE, rotateType } from '../blocks';
import { getBlockPoints } from '../blockshapes';
import type { Blueprint } from '../format';

describe('⇄ mirrored placement', () => {
  it('cell mirror is about the FILE world x = 0 plane and involutive', () => {
    // cell-boundary lattice: cell c covers [(c−6)·CELL, (c−5)·CELL), so
    // world x = 0 sits at cell coord 6 and [c, c+e) twins at [12−c−e, 12−c):
    // a 1-cell block at abs 8 (world +0.5…+0.75) twins at [3,4) (−0.75…−0.5)
    expect(mirrorBlockCell(8, 0)).toBe(3);
    expect(mirrorBlockCell(3, 0)).toBe(8);
    // a size-3 footprint (4 cells) [8, 12) (world +0.5…+1.5) → [0, 4) (−1.5…−0.5)
    expect(mirrorBlockCell(8, 3)).toBe(0);
    // involutive for any footprint
    for (const [c, s] of [[8, 0], [-1, 3], [5, 0], [-14, 12], [0, 1]] as const)
      expect(mirrorBlockCell(mirrorBlockCell(c, s), s)).toBe(c);
  });

  it('MIRROR_TYPE is a closed involution on the shape table, cube-stable', () => {
    expect(MIRROR_TYPE[0]).toBe(0);                  // cube mirrors to cube
    for (let t = 1; t <= 52; t++) {
      const m = MIRROR_TYPE[t]!;
      expect(m).toBeGreaterThanOrEqual(1);           // stays in the shape table
      expect(MIRROR_TYPE[m]).toBe(t);                // involutive
    }
    // the mirror is NOT identity for chiral shapes: at least one slope and
    // one corner change orientation
    let moved = 0;
    for (let t = 1; t <= 52; t++) if (MIRROR_TYPE[t] !== t) moved++;
    expect(moved).toBeGreaterThan(8);
  });

  it('MIRROR_TYPE matches the true mirrored vertex cloud', () => {
    // independent check: the mirrored type's cloud equals x-flipped cloud
    const key = (t: number, flip: boolean) =>
      getBlockPoints(t, [0, 0, 0], [1, 1, 1])
        .map(p => (flip ? 1 - p[0] : p[0]).toFixed(3) + ',' + p[1].toFixed(3) + ',' + p[2].toFixed(3))
        .sort().join(';');
    for (const t of [1, 3, 5, 7, 13, 15, 21, 25, 45, 47])
      expect(key(MIRROR_TYPE[t]!, false)).toBe(key(t, true));
  });

  it('mirroredBlock twin: same footprint+paint, mirrored cell and type', () => {
    const b = blockFromCell([8, 5, 8], [2, 0, 0], 13, 7);     // corner, 3×1×1
    const twin = mirroredBlock(b);
    expect(blockCells(twin).x).toBe(mirrorBlockCell(8, 2));
    expect(blockCells(twin).y).toBe(5);
    expect(blockCells(twin).z).toBe(8);
    expect(twin.size_x).toBe(2);
    expect(twin.type).toBe(MIRROR_TYPE[13]);
    expect(twin.colors).toEqual(b.colors);
    // twin of the twin = original
    const back = mirroredBlock(twin);
    expect(blockCells(back)).toEqual(blockCells(b));
    expect(back.type).toBe(13);
    // pos_* stay in the writer's 0..12 range across frames
    for (const c of [-40, -13, 0, 47]) {
      const t2 = mirroredBlock(blockFromCell([c, 5, 8], [0, 0, 0], 0, 4));
      expect(t2.pos_x).toBeGreaterThanOrEqual(0);
      expect(t2.pos_x).toBeLessThanOrEqual(12);
    }
  });
});

describe('cell lattice (cellIndex ≡ cull/tris cell-boundary convention)', () => {
  it('cell c covers [(c−6)·CELL, (c−5)·CELL)', () => {
    expect(cellIndex(-1.5)).toBe(0);          // cell 0 spans [−1.5, −1.25)
    expect(cellIndex(-1.26)).toBe(0);
    expect(cellIndex(-1.25)).toBe(1);
    expect(cellIndex(0.5)).toBe(8);           // world +0.5 = abs cell 8
    expect(cellIndex(0.74)).toBe(8);
  });
  it('blockAt resolves a point inside a block to its index', () => {
    const bp = { data: { blocks: [
      { ...blockFromCell([8, 5, 8], [0, 0, 0], 0, 4) },
      { ...blockFromCell([8, 5, 8], [0, 0, 0], 255, 0) },   // occupancy: never claimed
    ] } } as unknown as Blueprint;
    expect(blockAt(bp, { x: 0.6, y: -0.1, z: 0.6 })).toBe(0);
    expect(blockAt(bp, { x: 0.87, y: -0.1, z: 0.6 })).toBe(-1);   // just past [8+1 cell)
  });
});

describe('Shift continuation placement (the game: logically add the next block)', () => {
  const info = (cell: [number, number, number], size: [number, number, number], type: number) =>
    ({ bi: 0, cell, size, type, slot: 4 });

  it('cube axis-face hits: flush copy on the aimed face, size and paint ride over', () => {
    const i = info([10, 20, 30], [2, 0, 1], 0);
    expect(complementBlock(i, [11, 21, 31], [0, 1, 0]).cell).toEqual([10, 21, 30]);
    expect(complementBlock(i, [11, 20, 31], [0, -1, 0]).cell).toEqual([10, 19, 30]);
    expect(complementBlock(i, [10, 20.5, 31], [-1, 0, 0]).cell).toEqual([7, 20, 30]);  // −x: c − (sx+1)
    const s = complementBlock(i, [11, 20, 31], [0, 0, 1]);
    expect(s.size).toEqual([2, 0, 1]);         // ADAPTS to the aimed block's size
    expect(s.type).toBe(0);
    expect(s.slot).toBe(4);                    // matches the aimed block's paint
  });

  it('slope slant hits: flush diagonal step, scaled by the footprint', () => {
    // type 1 base orientation: solid y+z ≤ e, slant normal (0,+1,+1)/√2,
    // high edge at z = 0. Beyond the LOW edge the ramp continues down-forward.
    const i = info([10, 20, 30], [0, 0, 0], 1);
    const n: [number, number, number] = [0, Math.SQRT1_2, Math.SQRT1_2];
    expect(complementBlock(i, [10.5, 20.05, 30.95], n).cell).toEqual([10, 19, 31]);  // down-step
    expect(complementBlock(i, [10.5, 20.95, 30.05], n).cell).toEqual([10, 21, 29]);  // up-back
    // big block: the coplanar lattice step scales per axis (e = size+1)
    const big = info([10, 20, 30], [1, 1, 2], 1);
    expect(complementBlock(big, [11, 20.05, 32.9], n).cell).toEqual([10, 18, 33]);   // (0,−e_y,+e_z)
  });

  it('corner slant hits: the step is COPLANAR with the slant plane', () => {
    // type 13 base: slant through (0,0,0),(1,1,0),(1,0,1) → integer normal (−1,1,1)
    const i = info([4, 4, 4], [0, 0, 0], 13);
    const n: [number, number, number] = [-0.5774, 0.5774, 0.5774];
    for (const hit of [[4.9, 4.9, 4.05], [4.05, 4.05, 4.9], [4.9, 4.05, 4.95]]) {
      const c = complementBlock(i, hit as [number, number, number], n).cell;
      const d = [c[0] - 4, c[1] - 4, c[2] - 4];
      expect(-d[0] + d[1] + d[2]).toBe(0);     // m·d = 0 → ghost slant plane == block slant plane
      expect(d).not.toEqual([0, 0, 0]);        // never back inside the aimed block
    }
  });

  it('continuation never lands on the aimed block and keeps footprint/type', () => {
    const i = info([0, 0, 0], [1, 2, 3], 45);  // inverse corner
    const s = complementBlock(i, [1, 3.9, 1], [0, 1, 0]);
    expect(s.cell).toEqual([0, 3, 0]);         // c_y + (size_y+1)
    expect(s.type).toBe(45);
    expect(s.size).toEqual([1, 2, 3]);
  });

  it('cellOverlap guards the footprint (the red ghost refuses)', () => {
    const bp = { data: { blocks: [
      blockFromCell([8, 5, 8], [1, 0, 0], 0, 4),               // cells x[8,10) y[5,6) z[8,9)
      blockFromCell([8, 5, 20], [0, 0, 0], 255, 0),            // occupancy: no geometry
    ] } } as unknown as Blueprint;
    expect(cellOverlap(bp, [9, 5, 8], [0, 0, 0])).toBe(true);      // inside the slab
    expect(cellOverlap(bp, [10, 5, 8], [0, 0, 0])).toBe(false);    // flush-past the +x end
    expect(cellOverlap(bp, [8, 5, 20], [0, 0, 0])).toBe(false);    // over a 255 marker
    expect(cellOverlap(bp, [8, 5, 8], [2, 0, 0])).toBe(true);      // spanning overlap
  });

  it('rotateType cycles the orientation families (the game scroll wheel)', () => {
    expect(rotateType(0)).toBe(0);             // cube: one orientation
    expect(rotateType(1)).toBe(2); expect(rotateType(12)).toBe(1);   // slope 1..12
    expect(rotateType(20)).toBe(13);                                // corner 13..20
    expect(rotateType(44)).toBe(21);                                // pyramid 21..44
    expect(rotateType(52)).toBe(45);                                // inv corner 45..52
    expect(rotateType(99)).toBe(0);
  });
});
