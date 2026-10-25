// tris.ts pins: the EXACT hull lattice (world = g·0.25 − 1.5, AGENTS-
// verified), corner snapping round-trip, frame normalisation preserving
// the world maths, degenerate rejection, and triAt selection — plus the
// ISW corpus check that stored vertices land inside the craft bbox.
import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { cornerOf, cornerWorld, triAt, triCentroid, triangleFromCorners,
  triCorners, setTriCorner, setTriCornerAll, setTriCornersAll, shiftTriCells, triSpan } from '../tris';
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
    // the plane offset of the prism skin face (±0.025) still belongs to it
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

describe('v1.10.6 panel vertex editing (setTriCorner / shiftTriCells)', () => {

  test('triCorners round-trips the (frame, v) split to global corners', () => {
    const g0: [number, number, number] = [25, 21, 22];
    const g1: [number, number, number] = [17, 22, 22];
    const g2: [number, number, number] = [25, 22, 6];
    const t = triangleFromCorners(g0, g1, g2, [51, 51, 51, 51, 51])!;
    expect(triCorners(t)).toEqual([g0, g1, g2]);
  });

  test('setTriCorner moves ONE corner, writer-style refactor, returns changes', () => {
    const t = triangleFromCorners([8, 8, 8], [12, 8, 8], [8, 12, 8], [51, 51, 51, 51, 51])!;
    const ch = setTriCorner(t, 2, 1, 20);                      // v1.y 12 → 20
    expect(ch).not.toBeNull();
    expect(triCorners(t)[2]).toEqual([8, 20, 8]);
    // the changed-field map carries ONLY the fields whose number moved
    // (applyTriDelta filters the rest) — exactly what the doc must mirror
    expect(Object.keys(ch!)).toEqual(['v2_y']);
    // …and re-applying them to the doc is consistent (world maths preserved)
    const o = t as unknown as Record<string, number>;
    for (let i = 0; i < 3; i++)
      for (let ax = 0; ax < 3; ax++) {
        const name = 'xyz'[ax]!;
        const world = (o[`v${i}_${name}`]! + 12 * o[`frame_${name}`]! - 6) * 0.25;
        expect(world).toBeCloseTo(triCorners(t)[i]![ax]! * 0.25 - 1.5, 9);
      }
    expect(triSpan(t)).toEqual([4, 12, 0]);
  });

  test('setTriCorner REFUSES degenerate corners and the 32-slot window', () => {
    const t = triangleFromCorners([8, 8, 8], [12, 8, 8], [8, 12, 8], [51, 51, 51, 51, 51])!;
    const before = JSON.stringify(t);
    // v2 (8,12,8) pulled to (8,8,8) would FOLD onto v0 — the degenerate
    // guard fires on that single axis move…
    expect(setTriCorner(t, 2, 1, 8)).toBeNull();
    expect(JSON.stringify(t)).toBe(before);                    // record untouched
    // …and the frame-aligned window guard: y 12 → 48 puts v2_y = 48 − 0 > 31
    expect(setTriCorner(t, 2, 1, 48)).toBeNull();
    expect(JSON.stringify(t)).toBe(before);
  });

  test('shiftTriCells moves the WHOLE triangle; window refusal is honest', () => {
    const t = triangleFromCorners([8, 8, 8], [12, 8, 8], [8, 12, 8], [51, 51, 51, 51, 51])!;
    const ch = shiftTriCells(t, [1, 0, -2]);
    expect(ch).not.toBeNull();
    expect(triCorners(t)).toEqual([[9, 8, 6], [13, 8, 6], [9, 12, 6]]);
    for (let i = 0; i < 3; i++) expect(Object.keys(ch!).includes(`v${i}_x`)).toBe(true);
    // a triangle hugging the window (span 31…): +1 is REFUSED, record kept
    const big = triangleFromCorners([0, 0, 0], [31, 0, 0], [0, 31, 0], [51, 51, 51, 51, 51])!;
    const before = JSON.stringify(big);
    expect(shiftTriCells(big, [1, 0, 0])).toBeNull();
    expect(JSON.stringify(big)).toBe(before);
  });

  test('frame re-anchor: a negative shift stays writer-style (v near 0)', () => {
    const t = triangleFromCorners([8, 8, 8], [12, 8, 8], [8, 12, 8], [51, 51, 51, 51, 51])!;
    expect(shiftTriCells(t, [-10, 0, 0])).not.toBeNull();
    const o = t as unknown as Record<string, number>;
    expect(o.frame_x).toBeLessThan(0);                          // frame followed
    expect(o.v0_x).toBeGreaterThanOrEqual(0);                   // v starts near 0
    expect(triCorners(t)[0]).toEqual([-2, 8, 8]);
  });

  test('v1.11 setTriCornersAll writes a ROTATED corner triple atomically', () => {
    const t = triangleFromCorners([8, 8, 8], [12, 8, 8], [8, 12, 8], [51, 51, 51, 51, 51])!;
    const ch = setTriCornersAll(t, [[10, 6, 10], [10, 10, 10], [6, 10, 12]]);
    expect(ch).not.toBeNull();
    expect(triCorners(t)).toEqual([[10, 6, 10], [10, 10, 10], [6, 10, 12]]);
    const before = JSON.stringify(t);
    // ANY pair collapsing → whole write refused, record byte-intact
    expect(setTriCornersAll(t, [[5, 5, 5], [5, 5, 5], [7, 7, 7]])).toBeNull();
    expect(JSON.stringify(t)).toBe(before);
    // the 32-slot window applies to the WHOLE triple, not one corner
    expect(setTriCornersAll(t, [[8, 8, 8], [60, 8, 8], [8, 12, 8]])).toBeNull();
    expect(JSON.stringify(t)).toBe(before);
  });

  test('v1.11 setTriCornerAll moves ONE corner on ALL 3 axes (the pin editor)', () => {
    const t = triangleFromCorners([8, 8, 8], [12, 8, 8], [8, 12, 8], [51, 51, 51, 51, 51])!;
    // a pin drag lands a full 3-vector (cornerOf of a surface point)
    const ch = setTriCornerAll(t, 0, [30, 9, 25]);
    expect(ch).not.toBeNull();
    expect(triCorners(t)[0]).toEqual([30, 9, 25]);
    // every axis moved → the changed map carries v0_x, v0_y, v0_z (frames too,
    // the record re-anchors so v stays in the 32-slot window)
    for (const k of ['v0_x', 'v0_y', 'v0_z']) expect(ch!).toHaveProperty(k);
    // re-applying to the doc keeps the exact lattice (world = (v+12f−6)·0.25)
    const o = t as unknown as Record<string, number>;
    for (let ax = 0; ax < 3; ax++) {
      const name = 'xyz'[ax]!;
      expect((o[`v0_${name}`]! + 12 * o[`frame_${name}`]! - 6) * 0.25)
        .toBeCloseTo(triCorners(t)[0]![ax]! * 0.25 - 1.5, 9);
    }
  });

  test('v1.11 setTriCornerAll REFUSES coincident corners + the vertex window', () => {
    const t = triangleFromCorners([8, 8, 8], [12, 8, 8], [8, 12, 8], [51, 51, 51, 51, 51])!;
    const before = JSON.stringify(t);
    expect(setTriCornerAll(t, 2, [8, 8, 8])).toBeNull();        // folds onto v0
    expect(JSON.stringify(t)).toBe(before);
    expect(setTriCornerAll(t, 1, [8, 8, 60])).toBeNull();       // v1_z 60 > 31
    expect(JSON.stringify(t)).toBe(before);
  });
});
