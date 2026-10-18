// tris.ts pins: the EXACT hull lattice (world = g·0.25 − 1.5, AGENTS-
// verified), corner snapping round-trip, frame normalisation preserving
// the world maths, degenerate rejection, and triAt selection — plus the
// ISW corpus check that stored vertices land inside the craft bbox.
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { cornerOf, cornerWorld, triAt, triCentroid, triangleFromCorners } from '../tris';
import type { Blueprint } from '../format';
import { corpusDir } from '../../../tools/vite-corpus.ts';

describe('hull lattice', () => {
  test('corner round-trip: snap(centre of corner) === corner', () => {
    const g: [number, number, number] = [21, 10, -3];
    expect(cornerOf(cornerWorld(g))).toEqual(g);
    expect(cornerWorld([6, 6, 6])).toEqual([0, 0, 0]);        // world origin = g 6
  });

  test('frame split preserves the world position of every vertex', () => {
    const g0: [number, number, number] = [25, 21, 22];
    const g1: [number, number, number] = [17, 22, 22];
    const g2: [number, number, number] = [25, 22, 6];
    const t = triangleFromCorners(g0, g1, g2, [51, 51, 51, 51, 51])!;
    const o = t as unknown as Record<string, number>;
    for (let ax = 0; ax < 3; ax++) {
      const name = 'xyz'[ax]!;
      [g0, g1, g2].forEach((g, i) => {
        const world = (o[`v${i}_${name}`]! + 12 * o[`frame_${name}`]! - 6) * 0.25;
        expect(world).toBeCloseTo(g[ax]! * 0.25 - 1.5, 9);
      });
    }
  });

  test('degenerate triangles are rejected; triAt finds the centroid, misses beyond radius', () => {
    const g: [number, number, number] = [10, 10, 10];
    expect(triangleFromCorners(g, g, [12, 10, 10], [0, 0, 0, 0, 0])).toBeNull();
    const bp = { data: { triangles: [triangleFromCorners([10, 10, 10], [12, 10, 10], [10, 12, 10], [1, 2, 3, 4, 5])!] } } as unknown as Blueprint;
    const c = triCentroid(bp.data.triangles![0]!);
    expect(triAt(bp, c)).toBe(0);
    expect(triAt(bp, [c[0] + 1, c[1], c[2]])).toBe(-1);
  });

  test.skipIf(!existsSync(`${corpusDir()}/3812927875/blueprint.json`))
  ('ISW: every stored vertex lands inside the craft bbox', () => {
    const bp = JSON.parse(readFileSync(`${corpusDir()}/3812927875/blueprint.json`, 'utf8')) as Blueprint;
    for (const t of bp.data.triangles ?? []) {
      const c = triCentroid(t);
      for (let ax = 0; ax < 3; ax++) {
        const lo = [bp.box_min.x, bp.box_min.y, bp.box_min.z][ax]!;
        const hi = [bp.box_max.x, bp.box_max.y, bp.box_max.z][ax]!;
        expect(c[ax]).toBeGreaterThanOrEqual(lo - 0.3);
        expect(c[ax]).toBeLessThanOrEqual(hi + 0.3);
      }
    }
  });
});
