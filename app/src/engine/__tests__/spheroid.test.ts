// spheroid.test.ts — pins for the block-spheroid generator and the triangle
// skin (v1.6.1 staircase+chamfer rewrite). The law under test:
//  • the block solid is SEALED, disjoint and bounded; the interior is 100 %
//    filled with the FEWEST square blocks (merged boxes);
//  • the chamfers are COHERENT: every convex step edge gets a wedge/corner,
//    every cut faces the way the true surface falls, and no shape is placed
//    against a wall (the "jagged, lots of indentations" v1.6.0 verdict);
//  • the whole plan is mirror-symmetric about every ellipsoid axis plane;
//  • the TRIANGLE skin is watertight (every edge exactly two triangles),
//    lattice-exact, outward-wound, frame-legal, and cheap at zeppelin scale.
import { describe, expect, test } from 'vitest';
import {
  classify, spheroidBlocks, spheroidOverlaps, spheroidPlan, spheroidStats,
  spheroidTriangles, type SpheroidSpec,
} from '../spheroid';
import { CELL } from '../format';
import { getBlockPoints, getTypeRotation } from '../blockshapes';
import type { Block, Triangle } from '../format';

const sphere = (rM: number, over: Partial<SpheroidSpec> = {}): SpheroidSpec => ({
  center: [0, 0, 0], radii: [rM, rM, rM], material: 0, slot: 51, solid: true, ...over,
});

const cellOf = (b: Block) => ({
  x: (b.frame_x ?? 0) * 12 + b.pos_x,
  y: (b.frame_y ?? 0) * 12 + b.pos_y,
  z: (b.frame_z ?? 0) * 12 + b.pos_z,
});
const ckey = (x: number, y: number, z: number) => `${x}|${y}|${z}`;

/** ellipsoid radius of a world point: 1 = exactly on the surface */
const uOf = (p: [number, number, number], s: SpheroidSpec) => {
  let t = 0;
  for (let a = 0; a < 3; a++) { const q = (p[a]! - s.center[a]!) / s.radii[a]!; t += q * q; }
  return Math.sqrt(t);
};

/** the type's cut OUTWARD normal (same construction as the engine) */
function cutNormal(type: number): [number, number, number] {
  const canon: Record<number, [number, number, number] | null> = {
    0: null, 1: [0, Math.SQRT1_2, Math.SQRT1_2], 13: [-1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
    21: [-0.408, 0.816, 0.408], 45: [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)],
  };
  const shape = type === 0 ? 0 : type < 13 ? 1 : type < 21 ? 2 : type < 45 ? 3 : 4;
  const out = canon[shape === 0 ? 0 : shape === 1 ? 1 : shape === 2 ? 13 : shape === 3 ? 21 : 45]!;
  const m = getTypeRotation(type);
  return [
    m[0]! * out[0] + m[3]! * out[1] + m[6]! * out[2],
    m[1]! * out[0] + m[4]! * out[1] + m[7]! * out[2],
    m[2]! * out[0] + m[5]! * out[1] + m[8]! * out[2],
  ];
}

describe('spheroid blocks — sealed, disjoint, bounded, chamfered', () => {
  for (const r of [0.5, 1, 1.5, 2.5]) test(`solid r=${r}m`, () => {
    const spec = sphere(r);
    const blocks = spheroidBlocks(spec);
    expect(blocks.length).toBeGreaterThan(0);
    // (1) disjoint footprints + (2) SEALED: every centre-inside cell covered
    const seen = new Map<string, Block>();
    for (const b of blocks) {
      const c = cellOf(b);
      for (let i = 0; i <= b.size_x; i++)
        for (let j = 0; j <= b.size_y; j++)
          for (let k = 0; k <= b.size_z; k++) {
            const key = ckey(c.x + i, c.y + j, c.z + k);
            expect(seen.has(key), 'two spheroid blocks share a cell').toBe(false);
            seen.set(key, b);
          }
    }
    const R = r / CELL;
    for (let z = Math.floor(6 - R) - 1; z <= Math.ceil(6 + R) + 1; z++)
      for (let y = Math.floor(6 - R) - 1; y <= Math.ceil(6 + R) + 1; y++)
        for (let x = Math.floor(6 - R) - 1; x <= Math.ceil(6 + R) + 1; x++) {
          const p: [number, number, number] =
            [(x + 0.5 - 6) * CELL, (y + 0.5 - 6) * CELL, (z + 0.5 - 6) * CELL];
          if (uOf(p, spec) > 1) continue;
          expect(seen.has(ckey(x, y, z)), `inside cell (${x},${y},${z}) is a cavity`).toBe(true);
        }
    // (3) BOUNDED: every block cell has its centre inside (all blocks live
    // in the digital solid — nothing floats off the surface)
    for (const b of blocks) {
      const c = cellOf(b);
      for (let i = 0; i <= b.size_x; i++)
        for (let j = 0; j <= b.size_y; j++)
          for (let k = 0; k <= b.size_z; k++) {
            const p: [number, number, number] =
              [(c.x + i + 0.5 - 6) * CELL, (c.y + j + 0.5 - 6) * CELL, (c.z + k + 0.5 - 6) * CELL];
            expect(uOf(p, spec), 'block cell centre outside').toBeLessThanOrEqual(1);
          }
    }
    // (4) CHAMFER COHERENCE: each non-cube block's cut normal points along
    // the true outward gradient of ITS cell (the wedge cuts the side the
    // surface actually falls, never into a wall) — and every convex step
    // edge in the solid got a chamfer rather than a raw cube.
    for (const b of blocks) {
      if (b.type === 0) continue;
      const c = cellOf(b);
      const p: [number, number, number] =
        [(c.x + 0.5 - 6) * CELL, (c.y + 0.5 - 6) * CELL, (c.z + 0.5 - 6) * CELL];
      const g: [number, number, number] = [0, 1, 2].map(a => (p[a]! - spec.center[a]!) / spec.radii[a]! ** 2) as [number, number, number];
      const l = Math.hypot(...g) || 1;
      const n = cutNormal(b.type);
      const dot = (n[0] * g[0] + n[1] * g[1] + n[2] * g[2]) / l;
      expect(dot, `cut of type ${b.type} into a wall`).toBeGreaterThan(0.7);
    }
  });

  test('every convex step edge is chamfered (no raw step cubes at r=2m)', () => {
    const spec = sphere(2);
    const blocks = spheroidBlocks(spec);
    const covered = new Set<string>();
    for (const b of blocks) {
      const c = cellOf(b);
      for (let i = 0; i <= b.size_x; i++)
        for (let j = 0; j <= b.size_y; j++)
          for (let k = 0; k <= b.size_z; k++) covered.add(ckey(c.x + i, c.y + j, c.z + k));
    }
    const isSolid = (x: number, y: number, z: number) => {
      const p: [number, number, number] = [(x + 0.5 - 6) * CELL, (y + 0.5 - 6) * CELL, (z + 0.5 - 6) * CELL];
      return uOf(p, spec) <= 1;
    };
    // rebuild the digital solid; walk every solid cell for a convex 2-face
    // step edge (two adjacent air faces with the across-edge cell air too)
    const types = new Map<string, number>();
    for (const b of blocks) {
      const c = cellOf(b);
      if (b.size_x || b.size_y || b.size_z) continue;   // merged boxes are interior cubes
      types.set(ckey(c.x, c.y, c.z), b.type);
    }
    // a convex step edge is either chamfered OR deliberately kept as a cube
    // because the cell is ≥75 % full (an overfill bump reads smooth; a
    // slope's underfill there would read as an indentation — the v1.6.1 rule)
    const cellFill = (x: number, y: number, z: number) => {
      let n = 0;
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 4; j++)
          for (let k = 0; k < 4; k++) {
            const p: [number, number, number] = [
              (x + (i + 0.5) / 4 - 6) * CELL, (y + (j + 0.5) / 4 - 6) * CELL, (z + (k + 0.5) / 4 - 6) * CELL];
            if (uOf(p, spec) <= 1) n++;
          }
      return n / 64;
    };
    let convexEdges = 0, handled = 0, rawSteps = 0;
    for (const k of covered) {
      const [x, y, z] = k.split('|').map(Number) as [number, number, number];
      if (!isSolid(x, y, z)) continue;                  // only true-solid cells
      const air = ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const)
        .filter(d => !isSolid(x + d[0]!, y + d[1]!, z + d[2]!));
      if (air.length !== 2) continue;
      const a = air[0]!, b2 = air[1]!;
      if (a[0] === -b2[0] && a[1] === -b2[1] && a[2] === -b2[2]) continue;   // opposite pair
      if (isSolid(x + a[0] + b2[0], y + a[1] + b2[1], z + a[2] + b2[2])) continue; // concave
      convexEdges++;
      if ((types.get(k) ?? 0) !== 0 || cellFill(x, y, z) >= 0.75) handled++;
      else rawSteps++;
    }
    expect(convexEdges).toBeGreaterThan(20);            // a real staircase
    expect(rawSteps / convexEdges).toBeLessThan(0.05);  // raw steps are the exception
  });

  test('3-face staircase cells chamfer too (the diagonal band is never raw)', () => {
    const spec = sphere(3);
    const types = new Map<string, number>();
    for (const b of spheroidBlocks(spec)) {
      if (b.size_x || b.size_y || b.size_z) continue;
      const c = cellOf(b);
      types.set(ckey(c.x, c.y, c.z), b.type);
    }
    const solid = (x: number, y: number, z: number) =>
      uOf([(x + 0.5 - 6) * CELL, (y + 0.5 - 6) * CELL, (z + 0.5 - 6) * CELL], spec) <= 1;
    let three = 0, chamfered = 0;
    const lo = Math.floor(6 - 3 / CELL) - 1, hi = Math.ceil(6 + 3 / CELL) + 1;
    for (let z = lo; z <= hi; z++) for (let y = lo; y <= hi; y++) for (let x = lo; x <= hi; x++) {
      if (!solid(x, y, z)) continue;
      const air = ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const)
        .filter(d => !solid(x + d[0], y + d[1], z + d[2]));
      if (air.length !== 3) continue;
      if (air.some(p => air.some(q => p[0] === -q[0] && p[1] === -q[1] && p[2] === -q[2]))) continue;
      three++;
      if ((types.get(ckey(x, y, z)) ?? 0) !== 0) chamfered++;
    }
    expect(three).toBeGreaterThan(50);
    expect(chamfered / three).toBeGreaterThan(0.9);
  });

  test('block vertices stay within a cell diagonal of the surface', () => {
    const spec = sphere(2);
    const rMin = Math.min(...spec.radii);
    const band = Math.sqrt(3) * CELL * 1.6;
    let vertices = 0;
    for (const b of spheroidBlocks(spec)) {
      const c = cellOf(b);
      const origin: [number, number, number] = [(c.x - 6) * CELL, (c.y - 6) * CELL, (c.z - 6) * CELL];
      const size: [number, number, number] = [(b.size_x + 1) * CELL, (b.size_y + 1) * CELL, (b.size_z + 1) * CELL];
      for (const p of getBlockPoints(b.type, origin, size)) {
        const u = uOf(p, spec);
        expect(Math.abs(u - 1) * rMin, `vertex of type ${b.type}`).toBeLessThanOrEqual(band);
        vertices++;
      }
    }
    expect(vertices).toBeGreaterThan(100);
  });

  test('filled volume matches the ellipsoid within 25 %', () => {
    const st = spheroidStats(sphere(2));
    const exact = (4 / 3) * Math.PI * (2 / CELL) ** 3;
    expect(st.interiorCells / exact).toBeGreaterThan(0.5);
    const est = st.interiorCells + st.shellCells * 0.5;
    expect(Math.abs(est - exact) / exact).toBeLessThan(0.25);
  });

  test('the chamfer families are all live on a sphere', () => {
    const fams = new Set<string>();
    for (const b of spheroidBlocks(sphere(2))) {
      if (b.type === 0) continue;
      fams.add(b.type < 13 ? 'slope' : b.type < 21 ? 'corner' : b.type < 45 ? 'pyramid' : 'invcorner');
    }
    expect(fams.has('slope')).toBe(true);
    expect(fams.has('pyramid')).toBe(true);
    expect(fams.has('invcorner')).toBe(true);
  });

  test('the interior merges into few big cubes', () => {
    const spec = sphere(2.5);
    const plan = spheroidPlan(spec);
    let interiorCells = 0;
    for (const b of plan.interior) interiorCells += b.ext[0]! * b.ext[1]! * b.ext[2]!;
    expect(interiorCells).toBeGreaterThan(100);
    expect(plan.interior.length).toBeLessThan(interiorCells / 4);
    expect(plan.interior.some(b => b.ext[0]! > 1 || b.ext[1]! > 1 || b.ext[2]! > 1)).toBe(true);
  });

  test('shell has no interior and hugs the surface', () => {
    const spec = sphere(2, { solid: false });
    const b = spheroidStats(spec);
    expect(b.interiorCells).toBe(0);
    expect(b.blocks).toBeGreaterThan(0);
    // every shell block sits within ~1.5 cells of the true surface
    for (const blk of spheroidBlocks(spec)) {
      const c = cellOf(blk);
      const p: [number, number, number] =
        [(c.x + 0.5 - 6) * CELL, (c.y + 0.5 - 6) * CELL, (c.z + 0.5 - 6) * CELL];
      expect(Math.abs(uOf(p, spec) - 1) * 2).toBeLessThanOrEqual(1.8 * CELL);
    }
  });

  test('sphere on the corner lattice is x-mirror symmetric (footprints)', () => {
    const spans = spheroidBlocks(sphere(1.5)).map(b => {
      const c = cellOf(b);
      return `${c.x}|${c.x + b.size_x}|${c.y}|${c.y + b.size_y}|${c.z}|${c.z + b.size_z}`;
    });
    const set = new Set(spans);
    for (const s of spans) {
      const [x0, x1, y0, y1, z0, z1] = s.split('|').map(Number) as [number, number, number, number, number, number];
      expect(set.has(`${11 - x1}|${11 - x0}|${y0}|${y1}|${z0}|${z1}`), `mirror of ${s}`).toBe(true);
    }
  });

  test('records are file-valid lattice + paints + material', () => {
    const spec = sphere(1.5, { material: 3 });
    for (const b of spheroidBlocks(spec)) {
      expect(b.type).toBeGreaterThanOrEqual(0);
      expect(b.type).toBeLessThan(53);
      for (const a of ['x', 'y', 'z'] as const) {
        expect(b[`pos_${a}`]).toBeGreaterThanOrEqual(0);
        expect(b[`pos_${a}`]! + b[`size_${a}`]!).toBeLessThanOrEqual(11);
      }
      expect(b.colors).toEqual([51, 51, 51, 51, 51, 51, 51]);
      expect(b.material).toBe(3);
    }
  });
});

describe('classify — the voxel rules themselves', () => {
  test('convex step edge → slope; concave edge → cube; nearly-full → cube', () => {
    const convex = classify([[0, 1, 0], [1, 0, 0]], () => false, [0.707, 0.707, 0], 0.5);
    expect(convex).toBeGreaterThanOrEqual(1);
    expect(convex).toBeLessThan(13);
    expect(classify([[0, 1, 0], [1, 0, 0]], (dx, dy) => dx === 1 && dy === 1, [0.707, 0.707, 0], 0.5)).toBe(0);
    expect(classify([[0, 1, 0], [1, 0, 0]], () => false, [0.707, 0.707, 0], 0.9)).toBe(0);
  });
  test('shoulder falling along the ridge too → pyramid', () => {
    // air faces +y and +x (ridge axis = z); gradient with a strong z part
    const t = classify([[0, 1, 0], [1, 0, 0]], () => false, [0.5, 0.5, 0.707], 0.45);
    expect(t).toBeGreaterThanOrEqual(21);
    expect(t).toBeLessThan(45);
  });
  test('recess → inverse corner; protruding corner shaves by fill', () => {
    const body = (dx: number, dy: number, dz: number) => dx !== 0 && dy !== 0 && dz !== 0;
    const cove = classify([[0, 1, 0], [1, 0, 0], [0, 0, 1]], body, [1, 1, 1], 0.5);
    expect(cove).toBeGreaterThanOrEqual(45);
    expect(cove).toBeLessThan(53);
    const high = classify([[0, 1, 0], [1, 0, 0], [0, 0, 1]], () => false, [1, 1, 1], 0.8);
    expect(high).toBeGreaterThanOrEqual(45);                    // inverse corner
    const mid = classify([[0, 1, 0], [1, 0, 0], [0, 0, 1]], () => false, [1, 1, 1], 0.5);
    expect(mid).toBeGreaterThanOrEqual(21);
    expect(mid).toBeLessThan(45);                               // pyramid
    const low = classify([[0, 1, 0], [1, 0, 0], [0, 0, 1]], () => false, [1, 1, 1], 0.2);
    expect(low).toBeGreaterThanOrEqual(13);
    expect(low).toBeLessThan(21);                               // corner tetra
  });
});

describe('spheroid skin — watertight triangle ellipsoid', () => {
  type TriG = [[number, number, number], [number, number, number], [number, number, number]];
  const decode = (t: Triangle): TriG =>
    [0, 1, 2].map(i => [
      (t[`v${i}_x`] as number) + 12 * (t.frame_x as number),
      (t[`v${i}_y`] as number) + 12 * (t.frame_y as number),
      (t[`v${i}_z`] as number) + 12 * (t.frame_z as number),
    ]) as unknown as TriG;

  test('watertight: every edge shared by exactly two triangles', () => {
    const tris = spheroidTriangles(sphere(2, { center: [0, 1.25, 0] }));
    expect(tris.length).toBeGreaterThan(100);
    const edges = new Map<string, number>();
    for (const t of tris) {
      const [a, b, c] = decode(t);
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
        const k = p < q ? `${p}|${q}` : `${q}|${p}`;   // undirected
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
    const bad = [...edges.entries()].filter(([, n]) => n !== 2);
    expect(bad.length, `${bad.length} non-manifold edges`).toBe(0);
  });

  test('lattice-exact, frame-legal, outward, painted', () => {
    const spec = sphere(3, { center: [1.5, 1.25, -0.75], material: 2, slot: 33 });
    for (const t of spheroidTriangles(spec)) {
      const g = decode(t);
      for (let ax = 0; ax < 3; ax++) {
        const name = 'xyz'[ax]!;
        for (let i = 0; i < 3; i++) {
          const v = t[`v${i}_${name}`] as number;
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(31);
        }
      }
      // outward: (b−a)×(c−a) · (centroid−centre) ≥ 0
      const [a, b, c] = g;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const m = [
        (a[0] + b[0] + c[0]) / 3 - 6 - spec.center[0]! / CELL,
        (a[1] + b[1] + c[1]) / 3 - 6 - spec.center[1]! / CELL,
        (a[2] + b[2] + c[2]) / 3 - 6 - spec.center[2]! / CELL,
      ];
      expect(n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]!).toBeGreaterThanOrEqual(0);
      expect(t.colors).toEqual([33, 33, 33, 33, 33]);
      expect(t.material).toBe(2);
      expect(t.smooth).toBe(1);                       // sheet-hull default
    }
  });

  test('flat shading omits the smooth key', () => {
    for (const t of spheroidTriangles(sphere(1), { shade: 'flat' }))
      expect((t as Record<string, unknown>)['smooth']).toBeUndefined();
  });

  test('skin stays on the lattice surface and scales cheaply', () => {
    const spec = sphere(2, { center: [0, 1.25, 0] });
    for (const t of spheroidTriangles(spec))
      for (const g of decode(t)) {
        const p: [number, number, number] = [(g[0] - 6) * CELL, (g[1] - 6) * CELL, (g[2] - 6) * CELL];
        const u = uOf(p, spec);
        expect(Math.abs(u - 1)).toBeLessThan(0.25);   // snap ≤ 1 cell diagonal / r
      }
    // a zeppelin: 16 × 4 × 4 m skin must stay in the hundreds, not tens of thousands
    const zp = spheroidTriangles({ ...sphere(1), radii: [16, 4, 4], center: [0, 4, 0] });
    expect(zp.length).toBeGreaterThan(200);
    expect(zp.length).toBeLessThan(20_000);
  });
});

describe('spheroidOverlaps — the red-ghost contract', () => {
  const deck: Block = {
    colors: [4, 4, 4, 4, 4, 4, 4], frame_x: 0, frame_y: 0, frame_z: 0, material: 0,
    pos_x: 2, pos_y: 5, pos_z: 3, size_x: 8, size_y: 0, size_z: 4, type: 0,
  };
  test('free air is clear, a deck through the middle collides', () => {
    expect(spheroidOverlaps(sphere(1), [])).toBe(false);
    expect(spheroidOverlaps(sphere(1), [deck])).toBe(true);
    expect(spheroidOverlaps({ ...sphere(1), center: [0, 2.0, 0] }, [deck])).toBe(false);
  });
});
