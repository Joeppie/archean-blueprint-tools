// hull.ts v1.16.3 FLAT-SHEET DISPLAY MODE pins (we: "triangles are so
// problematic to render properly.. render them as a flat surface, 2 sided
// but flat, so less problems with protruding edges and dashboards, toggle
// option on display — they occlude dashboards where blocks wouldnt and in
// game they dont"). The laws proved here:
//  • a record renders as exactly TWO faces (front colours[0] + back
//    colours[1]) — the 8-face prism and its rim walls are gone;
//  • ZERO THICKNESS: every sheet vertex sits EXACTLY on the recorded
//    lattice plane (no ±HULL_T caps) — this is what stops the skin from
//    burying coplanar dashboards;
//  • TWO-SIDED: the front keeps the authored winding (front normal), the
//    back is its exact reversal painted colours[1];
//  • missing colours entries resolve to slot 0;
//  • wire + record count are byte-identical to the prism skin (file law,
//    pick law and overlays untouched);
//  • the stitch entry honours the A/B flag: flat = flatHullSkin verbatim,
//    off = the pre-existing prism path unchanged.
import { afterEach, describe, expect, test } from 'vitest';
import {
  HULL_T, buildHullSkin, flatHullSkin, hullSheet, setSkinFlat,
  stitchHullSkin, type HullFace,
} from '../hull';
import type { Triangle } from '../format';
import { CELL } from '../format';

/** y-plane record at lattice row off, x/z corners g, colours per slot. */
const triY = (off: number, g: [number, number][], colors: number[]): Triangle => {
  const o: Record<string, number | number[]> = {
    v0_x: g[0]![0], v0_z: g[0]![1], v1_x: g[1]![0], v1_z: g[1]![1],
    v2_x: g[2]![0], v2_z: g[2]![1], frame_x: 0, frame_y: 0, frame_z: 0,
    v0_y: off, v1_y: off, v2_y: off, colors,
  };
  return o as unknown as Triangle;
};
/** world lattice map (hullfit law, frame 0): world = (g − 6)·CELL */
const wm = (g: number): number => (g - 6) * CELL;

const normal = (f: HullFace): [number, number, number] => {
  const [a, b, c] = f.tri;
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const wx = c[0]! - a[0]!, wy = c[1]! - a[1]!, wz = c[2]! - a[2]!;
  const n: [number, number, number] = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0]! / l, n[1]! / l, n[2]! / l];
};
const dot = (a: [number, number, number], b: [number, number, number]): number =>
  a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

const T = triY(10, [[8, 8], [9, 8], [9, 9]], [51, 4, 2, 3, 4]);

afterEach(() => setSkinFlat(false));

describe('hullSheet — the flat 2-sided record', () => {
  test('a record emits EXACTLY two faces (no caps, no rim walls)', () => {
    expect(hullSheet(T)).toHaveLength(2);
    expect(buildHullSkin([T]).faces).toHaveLength(8);   // the prism law stands
  });

  test('zero thickness: every vertex sits EXACTLY on the recorded plane', () => {
    for (const f of hullSheet(T))
      for (const v of f.tri) {
        expect(v[1]!).toBeCloseTo(wm(10), 12);          // no ±HULL_T offset
        expect(Math.abs(v[1]! - wm(10))).toBeLessThan(HULL_T);
      }
    // the front's corner list IS the record's lattice corners, in order
    const front = hullSheet(T)[0]!.tri;
    expect(front.map(v => [v[0]!, v[2]!]))
      .toEqual([[wm(8), wm(8)], [wm(9), wm(8)], [wm(9), wm(9)]]);
  });

  test('two-sided: front = colours[0] authored winding, back = colours[1] reversed', () => {
    const [f, b] = hullSheet(T);
    expect(f!.slot).toBe(51);
    expect(b!.slot).toBe(4);
    const nF = normal(f!), nB = normal(b!);
    expect(dot(nF, [0, -1, 0])).toBeGreaterThan(0.9999);  // x-z winding ⇒ front −y
    expect(dot(nB, [0, 1, 0])).toBeGreaterThan(0.9999);   // exact reversal
    // vertex-for-vertex the back is the front's reversed corner list
    expect(b!.tri.map(v => [v[0]!, v[1]!, v[2]!]))
      .toEqual([f!.tri[2]!, f!.tri[1]!, f!.tri[0]!].map(v => [v[0]!, v[1]!, v[2]!]));
  });

  test('bare records (no colors) resolve both sides to slot 0', () => {
    const bare = { ...T } as Triangle;
    delete (bare as unknown as Record<string, unknown>)['colors'];
    expect(hullSheet(bare).map(f => f.slot)).toEqual([0, 0]);
  });
});

describe('flatHullSkin + the stitch entry — the A/B seam', () => {
  const skin: Triangle[] = [
    ...[
      [[[8, 8], [9, 8], [9, 9]], [[9, 9], [8, 9], [8, 8]]] as [number, number][][],
    ].flatMap(pair => pair.map(g => triY(10, g, [3, 3, 3, 3, 3]))),   // cellPair law
    triY(10, [[8, 8], [11, 8], [8, 11]], [51, 4, 2, 3, 4]),           // painted: never stitched
  ];

  test('wire + record count are byte-identical to the prism skin', () => {
    expect(flatHullSkin(skin).wire).toEqual(buildHullSkin(skin).wire);
    expect(flatHullSkin(skin).tris).toBe(buildHullSkin(skin).tris);
  });

  test('face count: 2 per record (vs 8 per prism, 12 per stitched slab)', () => {
    expect(flatHullSkin(skin).faces).toHaveLength(6);
    expect(buildHullSkin(skin).faces).toHaveLength(24);
  });

  test('stitchHullSkin routes through the flat flag and back', () => {
    const stitched = stitchHullSkin(skin);                 // default: prism path
    expect(stitched.faces.length).toBeLessThan(24);        // pair stitched
    setSkinFlat(true);
    expect(stitchHullSkin(skin).faces).toEqual(flatHullSkin(skin).faces);
    setSkinFlat(false);
    expect(stitchHullSkin(skin).faces).toEqual(stitched.faces);
  });
});
