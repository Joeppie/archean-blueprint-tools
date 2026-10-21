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

  test('2026-10-20 click-owner pick: the middle of a BIG prism selects, edge/corner '
    + 'clicks stay corner-drafts, off-plane misses (the centroid-radius limit '
    + 'that made large triangles unselectable is gone)', () => {
    // a 20-cell right triangle (5 m legs) — the old 0.45 m centroid radius
    // could never reach most of its surface
    const big = triangleFromCorners([10, 10, 10], [30, 10, 10], [10, 10, 30], [1, 2, 3, 4, 5])!;
    const bp = { data: { triangles: [big] } } as unknown as Blueprint;
    const c = triCentroid(big);
    expect(triAt(bp, c)).toBe(0);
    // the prism skin face sits at/behind the plane (v1.5.14 back extrusion);
    // a probe point slightly in FRONT of it still belongs to the triangle
    // (triAt's mid-plane tolerance covers the prism depth either way)
    expect(triAt(bp, [c[0], c[1] + 0.025, c[2]])).toBe(0);
    // deep in a CORNER of the big triangle: inside, but < margin from the
    // legs → NOT a selection (a corner-draft target instead)
    expect(triAt(bp, [10 * 0.25 - 1.5 + 0.01, 10 * 0.25 - 1.5, 10 * 0.25 - 1.5 + 0.01])).toBe(-1);
    // outside the outline entirely
    expect(triAt(bp, [40 * 0.25 - 1.5, 40 * 0.25 - 1.5, 10 * 0.25 - 1.5])).toBe(-1);
    // off the plane (beyond the prism skin)
    expect(triAt(bp, [c[0], c[1] + 0.5, c[2]])).toBe(-1);
    // nearest of two coplanar prisms wins by depth/margin, not centroid
    const other = triangleFromCorners([40, 40, 10], [50, 40, 10], [40, 40, 50], [1, 2, 3, 4, 5])!;
    const bp2 = { data: { triangles: [big, other] } } as unknown as Blueprint;
    expect(triAt(bp2, triCentroid(other))).toBe(1);
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
