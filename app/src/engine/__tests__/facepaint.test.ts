// facepaint.test.ts — the v1.6 PALETTE layer: the usage census (the picker's
// "how often is this colour on the vessel"), the mirrored FACE-SLOT mapping
// (⇄ paint must land on the twin's OPPOSITE-facing face, since x is the
// mirrored axis) and the twin-pair paint write. Pure model pins; the pixel/
// UI side is pinned by e2e/paint.spec.ts.
import { describe, expect, it } from 'vitest';

import { faceSlots, blockFromCell, blockMirrorTwin, mirrorFaceOrder, mirroredBlock,
  mirroredFaceSlots, paintBlockFaces, paintTwinPair, setBlockGeom } from '../blocks';
import { MIRROR_TYPE } from '../blocks';
import { paletteUsage } from '../palette';
import type { Blueprint } from '../format';

const cubePair = (): Blueprint => {
  const b = blockFromCell([8, 5, 8], [0, 0, 0], 0, 0);
  b.colors = [0, 1, 2, 3, 4, 5, 6];
  const t = blockFromCell([3, 5, 8], [0, 0, 0], 0, 0);   // mirrorBlockCell(8,0)
  t.colors = [0, 1, 2, 3, 4, 5, 6];
  return { data: { blocks: [b, t], components: [], triangles: [] } } as unknown as Blueprint;
};

describe('⇄ face-slot mirror', () => {
  it('cube↔cube swaps the ±x pair and keeps the rest', () => {
    const bp = cubePair();
    // face order (cube): 0 top, 1 bottom, 2 +x, 3 −x, 4 −z, 5 +z, 6 unused
    expect(mirrorFaceOrder(bp.data.blocks[0]!, bp.data.blocks[1]!)).toEqual([0, 1, 3, 2, 4, 5, 6]);
  });
  it('a paint on the −x face lands on the twin’s +x face', () => {
    const bp = cubePair();
    expect(blockMirrorTwin(bp, 0)).toBe(1);
    const changed = paintTwinPair(bp, 0, 1, 9, [3]);
    expect(changed).toEqual([3]);
    expect(bp.data.blocks[0]!.colors).toEqual([0, 1, 2, 9, 4, 5, 6]);
    expect(bp.data.blocks[1]!.colors).toEqual([0, 1, 9, 3, 4, 5, 6]);
  });
  it('a uniform paint is paint-identical on both (face mapping is a no-op)', () => {
    const bp = cubePair();
    paintTwinPair(bp, 0, 1, 47);
    expect(bp.data.blocks[0]!.colors).toEqual([47, 47, 47, 47, 47, 47, 47]);
    expect(bp.data.blocks[1]!.colors).toEqual([47, 47, 47, 47, 47, 47, 47]);
  });
  it('paintBlockFaces is idempotent (a re-paint changes nothing)', () => {
    const bp = cubePair();
    paintTwinPair(bp, 0, 1, 9, [3]);
    expect(paintBlockFaces(bp.data.blocks[0]!, 9, [3])).toEqual([]);
  });
  it('slope ↔ its x-mirror maps every face by WORLD direction; mirroring twice restores', () => {
    for (let t = 1; t <= 52; t++) {
      const a = blockFromCell([8, 5, 8], [0, 0, 0], t, 0);
      a.colors = [10, 11, 12, 13, 14, 15, 16];
      const mt = MIRROR_TYPE[t]!;
      const b = blockFromCell([3, 5, 8], [0, 0, 0], mt, 0);
      const twin = mirroredFaceSlots(a, b);
      expect(twin.length).toBe(7);
      const back = mirroredFaceSlots({ ...b, colors: twin }, a);
      expect(back).toEqual(faceSlots(a));                     // involutive paint ride
    }
  });
  it('mirroredBlock carries the DIRECTION-MAPPED paint, not the raw copy', () => {
    const b = blockFromCell([8, 5, 8], [0, 0, 0], 0, 0);
    b.colors = [10, 11, 12, 13, 14, 15, 16];
    const twin = mirroredBlock(b);
    expect(twin.colors).toEqual([10, 11, 13, 12, 14, 15, 16]);   // ±x pair swapped
  });
});

describe('palette usage census', () => {
  it('counts block faces, triangle faces and v1 component pairs; skips 255', () => {
    const bp = {
      data: {
        blocks: [
          { ...blockFromCell([8, 5, 8], [0, 0, 0], 0, 7) },                 // 7× slot 7
          { ...blockFromCell([3, 5, 8], [0, 0, 0], 0, 7) },                 // 7× slot 7
          { pos_x: 5, pos_y: 5, pos_z: 5, frame_x: 0, frame_y: 0, frame_z: 0,
            size_x: 0, size_y: 0, size_z: 0, type: 255, colors: [9, 9, 9, 9, 9, 9, 9] },
        ],
        triangles: [{ colors: [7, 51, 51, 51, 51] }],
        components: [{ colors: [120, 130] }, { colors: { color1: { r: 1 } } }],
        colors: null,
      },
    } as unknown as Blueprint;
    const u = paletteUsage(bp, true);
    const bySlot = new Map(u.slots.map(s => [s.slot, s]));
    expect(bySlot.get(7)!.blocks).toBe(14);
    expect(bySlot.get(7)!.tris).toBe(1);
    expect(bySlot.get(51)!.tris).toBe(4);
    expect(bySlot.get(9)).toBeUndefined();                    // occupancy is not paint
    expect(bySlot.get(120)!.comps).toBe(1);
    expect(bySlot.get(130)!.comps).toBe(1);
    // legacy remap: slot 120 resolves the METAL family (not the v2 gap)
    expect(bySlot.get(120)!.color.metallic).toBe(1);
    expect(u.custom).toBe(1);                                 // the dict-painted comp
    expect(u.distinct).toBe(4);                               // 7, 51, 120, 130
  });
  it('empty craft census is empty', () => {
    const bp = { data: { blocks: [], components: [], triangles: [], colors: null } } as unknown as Blueprint;
    const u = paletteUsage(bp, false);
    expect(u.slots).toEqual([]);
    expect(u.custom).toBe(0);
  });
});

describe('geometry twin (panel ⇄ edits)', () => {
  it('a mirrored cx move keeps the pair on mirrored cells', () => {
    const bp = cubePair();
    const [b, t] = bp.data.blocks;
    setBlockGeom(b, [9, 5, 8], [0, 0, 0], 0);                  // self moves +1 x
    // mirrorGeom in the panel mirrors the NEW cell: mirrorBlockCell(9,0)=2
    setBlockGeom(t, [2, 5, 8], [0, 0, 0], 0);
    expect(blockMirrorTwin(bp, 0)).toBe(1);
  });
});
