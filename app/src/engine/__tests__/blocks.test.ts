// blocks.test.ts — pure BLOCKS-mode model pins: cell conversions and
// ⇄ MIRRORED placement (cell mirror plane, the mirrored shape-type table
// derived from the real geometry, the twin builder).
import { describe, expect, it } from 'vitest';

import { blockCells, blockFromCell, mirroredBlock, mirrorBlockCell, MIRROR_TYPE } from '../blocks';
import { getBlockPoints } from '../blockshapes';

describe('⇄ mirrored placement', () => {
  it('cell mirror is about the FILE world x = 0 plane and involutive', () => {
    // world = (abs − 5.5)·CELL ⇒ the x=0 plane sits at cell 5.5:
    // a 1-cell block at abs 8 (world +0.625…+0.875) twins at [2,3) (−0.875…−0.625)
    expect(mirrorBlockCell(8, 0)).toBe(2);
    expect(mirrorBlockCell(2, 0)).toBe(8);
    // a size-3 footprint (4 cells) [8, 12) (world +0.625…+1.625) → [−1, 3) (−1.625…−0.625)
    expect(mirrorBlockCell(8, 3)).toBe(-1);
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
