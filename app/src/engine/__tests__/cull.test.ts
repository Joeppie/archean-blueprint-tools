// cull.ts pins: the game's interior-wall rules (XenonViewer port) — cell-cut
// full faces + rectangle stitch, covered partials, duplicate-footprint
// partitions, and the transparency asymmetry (opaque faces survive behind a
// translucent neighbour; translucent ones still die).
import { describe, expect, test } from 'vitest';
import { culledBlocksSolids } from '../cull';
import type { Block } from '../format';

const block = (o: Partial<Block> & { pos_x: number; pos_y: number; pos_z: number }): Block => ({
  type: 0, size_x: 0, size_y: 0, size_z: 0, frame_x: 0, frame_y: 0, frame_z: 0, ...o,
});
const all = (slot: number) => [slot, slot, slot, slot, slot, slot, slot];

describe('culledBlocksSolids', () => {
  test('two glued opaque cubes: the shared face pair dies (20 tris, 20 edges)', () => {
    const { tris, edges } = culledBlocksSolids([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(3) }),
    ], null, true);
    expect(tris.length).toBe(20);
    expect(edges.length).toBe(20);
    // no triangle lies ON the seam plane x = (6−5.5)·0.25 = 0.125
    const seam = 0.125;
    for (const t of tris)
      expect(Math.abs(t.tri[0][0]! - seam) < 1e-9 && Math.abs(t.tri[1][0]! - seam) < 1e-9
        && Math.abs(t.tri[2][0]! - seam) < 1e-9).toBe(false);
  });

  test('transparency asymmetry: opaque survives behind glass, glass dies', () => {
    // legacy palette slot 172 = glass (opacity 4 → translucent); slot 3 opaque
    const { tris } = culledBlocksSolids([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(172) }),
    ], null, true);
    expect(tris.length).toBe(12 + 10);                  // A keeps all 6, B loses the seam
  });

  test('exact duplicate blocks vanish: full faces cull pairwise, duplicate footprints drop', () => {
    const { tris } = culledBlocksSolids([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
    ], null, true);
    expect(tris.length).toBe(0);
  });

  test('duplicate slope: the shared slant footprint is an interior partition too', () => {
    const s = [block({ type: 1, pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
               block({ type: 1, pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) })];
    expect(culledBlocksSolids(s, null, true).tris.length).toBe(0);
  });

  test('a lone big block stitches to RECTANGLES: size 2×1×0 = 6 quads spanning whole faces', () => {
    const { tris, edges } = culledBlocksSolids(
      [block({ pos_x: 5, pos_y: 5, pos_z: 5, size_x: 2, size_y: 1, colors: all(3) })], null, true);
    expect(tris.length).toBe(12);                        // 6 stitched quads, not 6×(3·2·2)
    expect(edges.length).toBe(12);                       // the box outline only
    // the top face spans the full 3×2 cells: some vertex pair is 0.75 m apart in x
    const xs = tris.flatMap(t => t.tri.map(p => p[0]!));
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.75, 6);
  });

  test('a 3-cell wall of cubes: per-block stitch, shared faces culled (14 quads, 28 edges)', () => {
    const row = [5, 6, 7].map(x => block({ pos_x: x, pos_y: 5, pos_z: 5, colors: all(3) }));
    const { tris, edges } = culledBlocksSolids(row, null, true);
    expect(tris.length).toBe(28);                        // 14 stitched quads (Euler V16+F14−2 = E28)
    expect(edges.length).toBe(28);
  });

  test('cross-frame seams cull: blocks in ADJACENT frames weld without a gap', () => {
    const { tris } = culledBlocksSolids([
      block({ pos_x: 11, pos_y: 5, pos_z: 5, frame_x: 0, colors: all(3) }),   // cell 11
      block({ pos_x: 0, pos_y: 5, pos_z: 5, frame_x: 1, colors: all(3) }),    // cell 12
    ], null, true);
    expect(tris.length).toBe(20);                        // welded: the seam face dies
  });
});
