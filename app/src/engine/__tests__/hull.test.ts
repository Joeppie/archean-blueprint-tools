// hull.ts pins: the game's prism skin — 8 outward-wound faces, the five
// colour slots in order, extrusion ±HULL_T along the flipped-winding normal
// (view space), everything convex, and the file→view z-mirror applied.
import { describe, expect, test } from 'vitest';
import { HULL_T, hullPrism } from '../hull';
import type { Triangle } from '../format';

// right triangle in the file y=0 plane at frame 1: legs 6 cells (1.5 m)
const T = {
  v0_x: 0, v0_y: 0, v0_z: 0, v1_x: 6, v1_y: 0, v1_z: 0, v2_x: 0, v2_y: 0, v2_z: 6,
  frame_x: 1, frame_y: 1, frame_z: 1, colors: [10, 11, 12, 13, 14, 99],
} as Triangle;

const sub = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v! - b[i]!);
const cross = (a: readonly number[], b: readonly number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!,
];
const faceN = (tri: readonly (readonly [number, number, number])[]) => {
  const n = cross(sub(tri[1]!, tri[0]!), sub(tri[2]!, tri[0]!));
  const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
  return n.map(v => v! / l) as [number, number, number];
};
const centroid = (tri: readonly (readonly [number, number, number])[]): [number, number, number] => [
  tri.reduce((s, v) => s + v[0]!, 0) / 3, tri.reduce((s, v) => s + v[1]!, 0) / 3,
  tri.reduce((s, v) => s + v[2]!, 0) / 3,
];

describe('hullPrism', () => {
  const faces = hullPrism(T);
  // the fixture's raw surface plane: file y = (v_y + 12·frame_y)·0.25 − 1.5
  const RAW_Y = (0 + 12 * 1) * 0.25 - 1.5;             // = 1.5 (lattice C!)

  test('closed prism: 1 front + 1 back + 2 per side wall, slots colours[0..4]', () => {
    expect(faces.map(f => f.slot)).toEqual([10, 11, 12, 12, 13, 13, 14, 14]);
  });

  test('front/back faces are parallel, opposite-wound and ±HULL_T off the surface', () => {
    const [front, back] = faces;
    const nf = faceN(front!.tri), nb = faceN(back!.tri);
    expect(nf[0]! * nb[0]! + nf[1]! * nb[1]! + nf[2]! * nb[2]!).toBeLessThan(-0.99);
    const yf = front!.tri.map(v => v[1]!);
    const yb = back!.tri.map(v => v[1]!);                        // ŷ-planar skin
    for (const v of [...yf, ...yb]) expect(Math.abs(v - RAW_Y)).toBeCloseTo(HULL_T, 10);
    expect((yf[0]! - RAW_Y) * (yb[0]! - RAW_Y)).toBeLessThan(0); // opposite sides
  });

  test('convex outward winding: every face normal points away from the prism centre', () => {
    const all = faces.flatMap(f => f.tri.map(v => [...v] as [number, number, number]));
    const mid: [number, number, number] = [0, 1, 2].map(i =>
      all.reduce((s, v) => s + v[i]!, 0) / all.length) as [number, number, number];
    for (const f of faces) {
      const n = faceN(f.tri);
      const c = centroid(f.tri);
      const d = sub(c, mid);
      expect(n[0]! * d[0]! + n[1]! * d[1]! + n[2]! * d[2]!).toBeGreaterThan(1e-6);
    }
  });

  test('z-mirror: file z ≥ 0 lands at view z ≤ 0 (v-verts of the whole prism)', () => {
    for (const f of faces) for (const v of f.tri) expect(v[2]!).toBeLessThanOrEqual(1e-9);
  });

  test('missing colours default to slot 0 (opaque hull, never magenta by omission)', () => {
    const bare = hullPrism({ ...T, colors: undefined });
    expect(bare.every(f => f.slot === 0)).toBe(true);
  });
});
