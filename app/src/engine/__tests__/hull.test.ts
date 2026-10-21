// hull.ts pins: the game's prism skin — 8 outward-wound faces, the five
// colour slots in order, and the v1.5.14 EXTRUSION LAW: the prism body
// lies BEHIND the triangle plane (front cap flush at −HULL_SEAM, back cap
// 0.05 m deeper along −normal), because the game keeps flush-mounted
// panels visible UNDER coplanar skin (fixture 9000006001 + the airliner
// census; a flush Dashboard's whole content is only 0..0.02 m proud, so a
// centred ±0.025 prism buries it — the game demonstrably does not).
// The front normal is the authored-winding cross (cross(v1−v0, v2−v0), the
// game's colours[0] side); everything convex. The file frame IS the
// display frame since the v0.180 de-mirror (no z-mirror).
import { describe, expect, test } from 'vitest';
import { HULL_SEAM, HULL_T, hullPrism } from '../hull';
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

  test('BEHIND-THE-PLANE extrusion (v1.5.14): front cap flush, body along −normal', () => {
    const [front, back] = faces;
    // front normal of the fixture's own winding (cross(v1−v0, v2−v0) = −ŷ
    // here), measured not assumed
    const surf: [number, number, number][] = [0, 1, 2].map(i => [
      (Number(T[`v${i}_x`]) + 12) * 0.25 - 1.5, RAW_Y, (Number(T[`v${i}_z`]) + 12) * 0.25 - 1.5,
    ] as [number, number, number]);
    const u = faceN(surf);
    const proj = (v: readonly [number, number, number]) =>
      (v[0]! - surf[0]![0]!) * u[0]! + (v[1]! - surf[0]![1]!) * u[1]! + (v[2]! - surf[0]![2]!) * u[2]!;
    for (const v of front!.tri) expect(proj(v)).toBeCloseTo(-HULL_SEAM, 10);
    for (const v of back!.tri) expect(proj(v)).toBeCloseTo(-HULL_SEAM - 2 * HULL_T, 10);
  });

  test('NOTHING stands in front of the surface (the dashboards-stay-visible law)', () => {
    // every prism vertex, projected on the authored front normal, sits AT
    // or BEHIND the triangle plane — so flush content (0..0.02 m in FRONT
    // of the face, the generated Dashboard relief) can never be covered.
    const surf: [number, number, number][] = [0, 1, 2].map(i => [
      (Number(T[`v${i}_x`]) + 12) * 0.25 - 1.5, RAW_Y, (Number(T[`v${i}_z`]) + 12) * 0.25 - 1.5,
    ] as [number, number, number]);
    const u = faceN(surf);                                       // front normal
    for (const f of faces) for (const v of f.tri) {
      const d = sub(v, surf[0]!);
      expect(d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!).toBeLessThanOrEqual(1e-9);
    }
  });

  test('front/back faces are parallel and opposite-wound', () => {
    const [front, back] = faces;
    const nf = faceN(front!.tri), nb = faceN(back!.tri);
    expect(nf[0]! * nb[0]! + nf[1]! * nb[1]! + nf[2]! * nb[2]!).toBeLessThan(-0.99);
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

  test('raw z kept (v0.180): file z ≥ 0 stays z ≥ 0 — no world mirror', () => {
    for (const f of faces) for (const v of f.tri) expect(v[2]!).toBeGreaterThanOrEqual(-HULL_SEAM - 2 * HULL_T - 1e-9);
  });

  test('front face (colours[0]) is the cross(v1−v0, v2−v0) side', () => {
    const v = [0, 1, 2].map(i => {
      const ax = (Number(T[`v${i}_x`]) + 12) * 0.25 - 1.5, az = (Number(T[`v${i}_z`]) + 12) * 0.25 - 1.5;
      return [ax, RAW_Y, az];
    });
    const n = cross(sub(v[1]!, v[0]!), sub(v[2]!, v[0]!));      // +ŷ-normal side here (right-hand)
    const front = faces[0]!;
    const nf = faceN(front.tri);
    expect(nf[0]! * n[0]! + nf[1]! * n[1]! + nf[2]! * n[2]!).toBeGreaterThan(0.99);
  });

  test('missing colours default to slot 0 (opaque hull, never magenta by omission)', () => {
    const bare = hullPrism({ ...T, colors: undefined });
    expect(bare.every(f => f.slot === 0)).toBe(true);
  });
});
