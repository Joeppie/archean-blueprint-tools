// build.ts pins: view-space z-mirror with flipped winding, per-colour merge,
// wire buffer, occupancy-mirror skipping, proxy boxes.
import { describe, expect, test } from 'vitest';
import { buildCompProxies, buildSolids, colorKey } from '../build';
import type { Block, Blueprint, Triangle } from '../format';
import { resolveColor } from '../palette';

const block = (o: Partial<Block> & { pos_x: number; pos_y: number; pos_z: number }): Block => ({
  type: 0, size_x: 0, size_y: 0, size_z: 0, frame_x: 0, frame_y: 0, frame_z: 0, ...o,
});
const bpOf = (blocks: Block[], triangles: Triangle[] = []): Blueprint => ({
  box_min: { x: -3, y: -3, z: -3 }, box_max: { x: 3, y: 3, z: 3 },
  data: { version: 1, blocks, components: [], triangles },
});

describe('buildSolids', () => {
  test('two same-colour cubes merge into one bucket; wire spans 24 edges', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: [3, 3, 3, 3, 3, 3, 3] }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: [3, 3, 3, 3, 3, 3, 3] }),
    ]);
    const { buckets, wire, stats } = buildSolids(bp);
    expect(stats.blocks).toBe(2);
    expect(buckets.size).toBe(1);                       // one mesh per colour
    const b = [...buckets.values()][0]!;
    expect(b.indices.length).toBe(2 * 36);              // 12 tris per cube
    expect(stats.tris).toBe(24);
    expect(wire.length).toBe(2 * 12 * 2 * 3);           // 2 blocks × 12 edges × 2 pts × xyz
  });

  test('different palette slots split into separate buckets', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: [3, 3, 3, 3, 3, 3, 3] }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: [48, 48, 48, 48, 48, 48, 48] }),
    ]);
    expect(buildSolids(bp).buckets.size).toBe(2);
  });

  test('occupancy (type 255) blocks get no geometry', () => {
    const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5, type: 255 })]);
    const { stats, buckets } = buildSolids(bp);
    expect(stats.blocks).toBe(0);
    expect(buckets.size).toBe(0);
  });

  test('inclusive size rule: the size field spans (size+1) cells (legacy blkSpan)', () => {
    const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5, size_x: 2 })]);
    const pos = [...buildSolids(bp).buckets.values()][0]!.positions;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < pos.length; i += 3) { min = Math.min(min, pos[i]!); max = Math.max(max, pos[i]!); }
    expect(max - min).toBeCloseTo(0.75, 10);            // 2+1 cells
  });

  test('view space mirrors z — cell W=−1.375 spans view z 1.25..1.5', () => {
    // pos_z 0 → origin W−CELL/2 = −1.5, extent 0.25 → view [+1.25, +1.5]
    const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 0 })]);
    const pos = [...buildSolids(bp).buckets.values()][0]!.positions;
    let min = Infinity, max = -Infinity;
    for (let i = 2; i < pos.length; i += 3) min = Math.min(min, pos[i]!), max = Math.max(max, pos[i]!);
    expect(min).toBeCloseTo(1.25, 10);
    expect(max).toBeCloseTo(1.5, 10);
  });

  test('mirrored winding keeps the outward face normal pointing out (+y top)', () => {
    const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5 })]);
    const b = [...buildSolids(bp).buckets.values()][0]!;
    const { topArea, upNormal } = (() => {
      let up = 0, down = 0;
      for (let i = 1; i < b.normals.length; i += 3) {
        if (b.normals[i]! > 0.9) up++;
        if (b.normals[i]! < -0.9) down++;
      }
      return { topArea: up, upNormal: down };
    })();
    expect(topArea).toBe(upNormal);                     // cube: mirror-antisymmetric
    expect(topArea).toBe(6);                            // 2 top tris × 3 verts
    // the +y normals must belong to the HIGH-y vertices (outward, not inward)
    // pos 5 → W −0.125, origin W−CELL/2 = −0.25 → cube y ∈ [−0.25, 0]
    for (let t = 0; t < b.indices.length; t += 3) {
      const n = b.normals[b.indices[t]! * 3 + 1]!;
      const y = b.positions[b.indices[t]! * 3 + 1]!;
      if (n > 0.9) expect(y).toBeCloseTo(0, 6);
      if (n < -0.9) expect(y).toBeCloseTo(-0.25, 6);
    }
  });

  test('glass slot stays its own bucket with alpha < 1', () => {
    const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: [4, 4, 4, 4, 4, 4, 4] })]);
    const b = [...buildSolids(bp).buckets.values()][0]!;
    expect(colorKey(b.color)).toBe(colorKey(resolveColor(null, 4, true)));
    expect(b.color.opacity).toBe(0);                    // clear glass
  });

  test('hull triangle becomes a 5-colour prism: 8 faces, front slot colours[0]', () => {
    const t = { v0_x: 0, v0_y: 0, v0_z: 0, v1_x: 6, v1_y: 0, v1_z: 0, v2_x: 0, v2_y: 0, v2_z: 6,
      frame_x: 1, frame_y: 1, frame_z: 1, colors: [51, 52, 53, 54, 55, 56] } as Triangle;
    const { stats, buckets } = buildSolids(bpOf([], [t]));
    expect(stats.hullTris).toBe(1);                     // one FILE triangle
    expect(stats.tris).toBe(8);                         // closed prism: 1+1+2·3 faces
    expect(buckets.size).toBe(5);                       // colours[0..4], back face distinct
  });

  test('hull surface edges join the wire buffer (3 edges per triangle)', () => {
    const t = { v0_x: 0, v0_y: 0, v0_z: 0, v1_x: 6, v1_y: 0, v1_z: 0, v2_x: 0, v2_y: 0, v2_z: 6,
      frame_x: 1, frame_y: 1, frame_z: 1, colors: [51] } as Triangle;
    const { wire } = buildSolids(bpOf([], [t]));
    expect(wire.length).toBe(3 * 2 * 3);                // 3 edges × 2 pts × xyz
  });
});

describe('buildCompProxies', () => {
  test('occupancy boxes mirror z; Build ghosts skipped; origin dot for the rest', () => {
    const bp: Blueprint = bpOf([]);
    bp.data.components = [
      { type: 'Wheel', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 },
        occupancies: { pos_x: 5, pos_y: 5, pos_z: 0, size_x: 2, size_y: 1, size_z: 1 } },
      { type: 'Build', position: { x: 900, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
      { type: 'Lamp', position: { x: 1, y: 2, z: -3 }, orientation: { w: 1, x: 0, y: 0, z: 0 } },
    ] as never;
    const boxes = buildCompProxies(bp);
    expect(boxes.length).toBe(2);                       // Build skipped
    expect(boxes[0]!.ci).toBe(0);
    expect(boxes[0]!.min.z).toBeCloseTo(1.0, 10);       // inclusive span: 2 cells → 0.5 m
    expect(boxes[0]!.size.z).toBe(0.5);
    expect(boxes[1]!.min.z).toBeCloseTo(2.85, 10);      // file z −3 → view +3 ±0.15
  });
});
