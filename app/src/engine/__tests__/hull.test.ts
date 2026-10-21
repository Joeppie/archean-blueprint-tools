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
import { HULL_SEAM, HULL_T, hullPrism, skinSolidDirs } from '../hull';
import type { Block, Triangle } from '../format';

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

  test('body = +1 MIRRORS the prism (inward-wound legacy skins): body on the '
    + 'winding side, colours[0] STILL the winding-normal cap, all convex', () => {
    const mirrored = hullPrism(T, 1);
    expect(mirrored.map(f => f.slot)).toEqual([10, 11, 12, 12, 13, 13, 14, 14]);
    // T's winding normal is −ŷ: with body = +1 the prism spans the plane on
    // the +ŷ side — every vertex projects ≥ +SEAM along u
    const surf: [number, number, number][] = [0, 1, 2].map(i => [
      (Number(T[`v${i}_x`]) + 12) * 0.25 - 1.5, RAW_Y, (Number(T[`v${i}_z`]) + 12) * 0.25 - 1.5,
    ] as [number, number, number]);
    const u = faceN(surf);
    for (const f of mirrored) for (const v of f.tri) {
      const d = sub(v, surf[0]!);
      expect(d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!).toBeGreaterThanOrEqual(HULL_SEAM - 1e-9);
    }
    // colours[0] cap stays on the +u (winding) side: its centroid projects
    // DEEPER (+) than colours[1]'s — mirrored from the default
    const pr = (tri: readonly (readonly [number, number, number])[]) => {
      const c = centroid(tri); const d = sub(c, surf[0]!);
      return d[0]! * u[0]! + d[1]! * u[1]! + d[2]! * u[2]!;
    };
    expect(pr(mirrored[0]!.tri)).toBeGreaterThan(pr(mirrored[1]!.tri));
    // convexity of the mirrored prism (caps + walls all face outward)
    const allv = mirrored.flatMap(f => f.tri.map(v => [...v] as [number, number, number]));
    const mid: [number, number, number] = [0, 1, 2].map(i =>
      allv.reduce((s, v) => s + v[i]!, 0) / allv.length) as [number, number, number];
    for (const f of mirrored) {
      const n = faceN(f.tri); const c = centroid(f.tri); const d = sub(c, mid);
      expect(n[0]! * d[0]! + n[1]! * d[1]! + n[2]! * d[2]!).toBeGreaterThan(1e-6);
    }
  });
});

// the v1.5.15 solid-side law: winding does NOT pick the extrusion side —
// the SOLID does (block hull when present, else the parallel far-side skin
// of the hullified wall). This is what keeps Jimmy's INWARD-wound murals
// visible: the flip signal there comes from the wall, not the winding.
describe('skinSolidDirs — extrude toward the solid, not toward the winding', () => {
  // a 12×12-cell horizontal "wall" strip: skin quads on one face at world
  // y (lattice law world = (L − 6)·0.25, stored v = L at frame 0)
  const quad = (y: number, upNormal: boolean): Triangle[] => {
    const g = Math.round(y / 0.25 + 6);
    const toT = (p: number[], q: number[], r: number[]): Triangle => ({
      v0_x: p[0], v0_y: p[1], v0_z: p[2],
      v1_x: q[0], v1_y: q[1], v1_z: q[2],
      v2_x: r[0], v2_y: r[1], v2_z: r[2],
    } as unknown as Triangle);
    const a = [6, g, 6], b = [18, g, 6], c = [18, g, 18], d = [6, g, 18];
    // (a,c,b)/(a,d,c) wind +ŷ seen from above; (a,b,c)/(a,c,d) wind −ŷ
    return upNormal ? [toT(a, c, b), toT(a, d, c)] : [toT(a, b, c), toT(a, c, d)];
  };

  test('parallel-skin signal (no geometry blocks): the wall side wins, '
    + 'INDEPENDENT of winding', () => {
    const topUp = quad(1.5, true);           // outward top (+ŷ)
    const bottomDown = quad(1.25, false);    // outward bottom (−ŷ)
    const dirs = skinSolidDirs([...topUp, ...bottomDown], []);
    expect(dirs.length).toBe(4);
    // top face: the far-side skin (solid) is 0.25 BELOW, on the −winding
    // side → the default law −1
    for (let i = 0; i < 2; i++) expect(dirs[i]!, `top quad ${i}`).toBe(-1);
    // bottom face (winds −ŷ): the solid sits 0.25 ABOVE it, again on its
    // −winding side → −1 as well — BOTH outward faces extrude into the wall
    for (let i = 2; i < 4; i++) expect(dirs[i]!, `bottom quad ${i}`).toBe(-1);
    // the Jimmy situation: the SAME top face wound INWARD (−ŷ) must FLIP
    const topIn = quad(1.5, false);
    const dirsIn = skinSolidDirs([...topIn, ...quad(1.25, true)], []);
    for (let i = 0; i < 2; i++) expect(dirsIn[i]!, `inward top quad ${i}`).toBe(1);
  });

  test('closed inward-wound SHELL (the Jimmy case): the parity vote flips the '
    + 'whole skin, so panel-facing caps stay out of the panels', () => {
    // a closed box soup (x 0..3 m, z 0..3 m, y 0..0.5 m) stored with INWARD
    // windings on EVERY face — hullify 'inward' soup, no blocks.
    const gT = Math.round(0.5 / 0.25 + 6), gB = Math.round(0 / 0.25 + 6);
    const CTR = [1.5, 0.25, 1.5];
    const toT = (p: number[], q: number[], r: number[]): Triangle => ({
      v0_x: p[0], v0_y: p[1], v0_z: p[2], v1_x: q[0], v1_y: q[1], v1_z: q[2], v2_x: r[0], v2_y: r[1], v2_z: r[2],
    } as unknown as Triangle);
    const wm = (g: number[]) => [ (g[0]! - 6) * 0.25, (g[1]! - 6) * 0.25, (g[2]! - 6) * 0.25 ];
    const crs = (a: number[], b: number[]): number[] =>
      [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
    const sbe = (a: number[], b: number[]): number[] => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
    // outward-wound triangle: normal away from the box centre
    const outT = (a: number[], b: number[], c: number[]): number[][] => {
      const wa = wm(a), wb = wm(b), wc = wm(c);
      const n = crs(sbe(wb, wa), sbe(wc, wa));
      const midw = [(wa[0]! + wb[0]! + wc[0]!) / 3, (wa[1]! + wb[1]! + wc[1]!) / 3, (wa[2]! + wb[2]! + wc[2]!) / 3];
      const d = sbe(midw, CTR);
      return n[0]! * d[0]! + n[1]! * d[1]! + n[2]! * d[2]! > 0 ? [a, b, c] : [a, c, b];
    };
    // INWARD quad = the outward triangles reversed
    const faceIn = (a: number[], b: number[], c: number[], d: number[]): Triangle[] => {
      const o1 = outT(a, b, c), o2 = outT(a, c, d);
      return [toT(o1[0]!, o1[2]!, o1[1]!), toT(o2[0]!, o2[2]!, o2[1]!)];
    };
    const A = [6, gT, 6], B = [18, gT, 6], C2 = [18, gT, 18], D = [6, gT, 18];
    const E = [6, gB, 6], F = [18, gB, 6], G = [18, gB, 18], H = [6, gB, 18];
    const tris = [
      ...faceIn(A, B, C2, D), ...faceIn(E, F, G, H),
      ...faceIn(A, B, F, E), ...faceIn(D, C2, G, H),
      ...faceIn(A, E, H, D), ...faceIn(B, C2, G, F),
    ];
    const dirs = skinSolidDirs(tris, []);
    // EVERY triangle of an inward shell must mirror (+1): the body goes
    // into the wall on the winding side, the flush cap stays air-side
    for (let i = 0; i < dirs.length; i++) expect(dirs[i]!, `tri ${i}`).toBe(1);
    // and the OUTWARD twin of the same soup keeps the default law everywhere
    const outward = tris.map(t => {
      const o = t as unknown as Record<string, number>;
      return { ...o, v1_x: o['v2_x'], v1_y: o['v2_y'], v1_z: o['v2_z'],
        v2_x: o['v1_x'], v2_y: o['v1_y'], v2_z: o['v1_z'] } as unknown as Triangle;
    });
    for (const d of Array.from(skinSolidDirs(outward, []))) expect(d).toBe(-1);
  });

  test('block-hull signal wins when blocks exist: coplanar face over a deck '
    + 'extrudes INTO the deck even when the skin is inward-wound', () => {
    const deck: Block = {
      type: 0, frame_x: 0, frame_y: 0, frame_z: 0, pos_x: 0, pos_y: 0, pos_z: 0,
      size_x: 11, size_y: 0, size_z: 11, material: 0, colors: [11, 11, 11, 11, 11, 11, 11],
    };
    // one INWARD-wound triangle on the deck TOP plane y = −1.25 (deck cells
    // y = 0 ⇒ top at cellM(1)): winding normal −ŷ (INTO the deck) — the
    // Jimmy mural situation.
    const inward: Triangle = {
      v0_x: 10, v0_y: 1, v0_z: 4, v1_x: 10, v1_y: 1, v1_z: 6, v2_x: 8, v2_y: 1, v2_z: 4,
      frame_x: 0, frame_y: 0, frame_z: 0,
    } as unknown as Triangle;
    const dirs = skinSolidDirs([inward], [deck]);
    expect(dirs[0]!).toBe(1);                 // body toward the deck: MIRRORED
    // the same triangle wound OUTWARD keeps the default law
    const outward: Triangle = {
      ...inward, v1_x: 8, v1_y: 1, v1_z: 4, v2_x: 10, v2_y: 1, v2_z: 6,
    } as unknown as Triangle;
    expect(skinSolidDirs([outward], [deck])[0]!).toBe(-1);
  });
});
