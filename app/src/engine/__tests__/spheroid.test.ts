// spheroid.test.ts — pins for the spheroid generators (v1.6.2 ADDITIVE
// rework after the user's verdict: "all spheres have edges with indentations
// where I can see a triangle is missing … indentations create aerodynamic
// problems and actively damage volume … the triangle mesh looks bad").
//  • BLOCKS: the solid is pure cubes (never cut); bevels are only ever
//    ADDED into air cells and seat their FULL faces on solid neighbours
//    (flush by construction — the pin that makes dents impossible); every
//    step/inside-corner air cell is bevelled; sealed, disjoint, bounded,
//    merged, mirror-symmetric.
//  • SKIN: watertight (every edge exactly two triangles), lattice-exact,
//    outward, and NO vertex snaps inside the surface (the v1.6.1 dents).
import { describe, expect, test } from 'vitest';
import {
  spheroidBlocks, spheroidOverlaps, spheroidPlan, spheroidStats,
  spheroidTriangles, type SpheroidSpec,
} from '../spheroid';
import { CELL } from '../format';
import { getBlockFaceDirections, getBlockPoints, isFullFace } from '../blockshapes';
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

/** the type's FULL-FACE directions (its flush seats) */
function fullDirs(type: number): [number, number, number][] {
  const dirs = getBlockFaceDirections(type);
  const out: [number, number, number][] = [];
  dirs.forEach((d, i) => { if (d && isFullFace(type, i)) out.push([d[0], d[1], d[2]]); });
  return out;
}

describe('spheroid blocks — additive, flush, sealed', () => {
  for (const r of [0.5, 1, 1.5, 2.5]) test(`solid r=${r}m`, () => {
    const spec = sphere(r);
    const blocks = spheroidBlocks(spec);
    expect(blocks.length).toBeGreaterThan(0);
    const solid = (x: number, y: number, z: number) => {
      const p: [number, number, number] =
        [(x + 0.5 - 6) * CELL, (y + 0.5 - 6) * CELL, (z + 0.5 - 6) * CELL];
      return uOf(p, spec) <= 1;
    };
    // (1) disjoint footprints
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
    // (2) SEALED: every centre-inside cell covered by a cube block
    const R = r / CELL;
    for (let z = Math.floor(6 - R) - 1; z <= Math.ceil(6 + R) + 1; z++)
      for (let y = Math.floor(6 - R) - 1; y <= Math.ceil(6 + R) + 1; y++)
        for (let x = Math.floor(6 - R) - 1; x <= Math.ceil(6 + R) + 1; x++) {
          if (!solid(x, y, z)) continue;
          const b = seen.get(ckey(x, y, z));
          expect(b, `inside cell (${x},${y},${z}) is a cavity`).toBeTruthy();
          expect(b!.type, 'solid interior was CUT into a shape').toBe(0);
        }
    // (3) ADDITIVE: a non-cube block only ever occupies AIR — its own cell
    // is outside the solid, and every FULL face rests on a solid neighbour
    // (flush seat ⇒ no crack, no cavity, no dent can form under it)
    let bevels = 0;
    for (const b of blocks) {
      if (b.type === 0) continue;
      bevels++;
      const c = cellOf(b);
      expect(solid(c.x, c.y, c.z), 'bevel placed inside the solid').toBe(false);
      for (const d of fullDirs(b.type))
        expect(solid(c.x + d[0], c.y + d[1], c.z + d[2]),
          `type ${b.type} full face pointing at air at (${c.x},${c.y},${c.z})`).toBe(true);
    }
    if (r >= 1) expect(bevels).toBeGreaterThan(8);      // bevels really happen
  });

  test('every step and inside corner gets a bevel (coverage)', () => {
    const spec = sphere(2);
    const solid = (x: number, y: number, z: number) => {
      const p: [number, number, number] =
        [(x + 0.5 - 6) * CELL, (y + 0.5 - 6) * CELL, (z + 0.5 - 6) * CELL];
      return uOf(p, spec) <= 1;
    };
    const types = new Map<string, number>();
    for (const b of spheroidBlocks(spec)) {
      if (b.size_x || b.size_y || b.size_z) continue;
      const c = cellOf(b);
      types.set(ckey(c.x, c.y, c.z), b.type);
    }
    const AX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
    let steps = 0, bevelled = 0, corners = 0;
    for (let z = -6; z <= 18; z++) for (let y = -6; y <= 18; y++) for (let x = -6; x <= 18; x++) {
      if (solid(x, y, z)) continue;                    // air cells only
      const sd = AX.filter(d => solid(x + d[0], y + d[1], z + d[2]));
      const opp = sd.some(p => sd.some(q => p[0] === -q[0] && p[1] === -q[1] && p[2] === -q[2]));
      if (opp) continue;
      const has = (types.get(ckey(x, y, z)) ?? 0) !== 0;
      if (sd.length === 2) { steps++; if (has) bevelled++; }
      if (sd.length === 3) corners++;
    }
    expect(steps).toBeGreaterThan(40);                 // a real staircase
    expect(bevelled / steps).toBeGreaterThan(0.97);    // ramped or tapered
    expect(corners).toBeGreaterThan(0);                // inside corners exist
  });

  test('block vertices stay within a cell diagonal of the surface', () => {
    const spec = sphere(2);
    const rMin = Math.min(...spec.radii);
    const band = Math.sqrt(3) * CELL * 1.7;
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

  test('the interior merges into few big cubes', () => {
    const spec = sphere(2.5);
    const plan = spheroidPlan(spec);
    let interiorCells = 0;
    for (const b of plan.interior) interiorCells += b.ext[0]! * b.ext[1]! * b.ext[2]!;
    expect(interiorCells).toBeGreaterThan(100);
    expect(plan.interior.length).toBeLessThan(interiorCells / 4);
    expect(plan.interior.some(b => b.ext[0]! > 1 || b.ext[1]! > 1 || b.ext[2]! > 1)).toBe(true);
  });

  test('shell has no merged interior and hugs the surface', () => {
    const spec = sphere(2, { solid: false });
    const b = spheroidStats(spec);
    expect(b.interiorCells).toBe(0);
    expect(b.blocks).toBeGreaterThan(0);
    for (const blk of spheroidBlocks(spec)) {
      const c = cellOf(blk);
      const p: [number, number, number] =
        [(c.x + 0.5 - 6) * CELL, (c.y + 0.5 - 6) * CELL, (c.z + 0.5 - 6) * CELL];
      expect(Math.abs(uOf(p, spec) - 1) * 2).toBeLessThanOrEqual(2.4 * CELL);
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

describe('spheroid skin — watertight, outward, NEVER dented', () => {
  type TriG = [[number, number, number], [number, number, number], [number, number, number]];
  const decode = (t: Triangle): TriG =>
    [0, 1, 2].map(i => [
      (t[`v${i}_x`] as number) + 12 * (t.frame_x as number),
      (t[`v${i}_y`] as number) + 12 * (t.frame_y as number),
      (t[`v${i}_z`] as number) + 12 * (t.frame_z as number),
    ]) as unknown as TriG;

  test('watertight: every edge shared by exactly two triangles', () => {
    const tris = spheroidTriangles(sphere(2, { center: [0, 1.25, 0] }));
    expect(tris.length).toBeGreaterThan(30);
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

  test('NO vertex inside the surface (skin dents are structurally gone)', () => {
    const spec = sphere(2, { center: [0, 1.25, 0] });
    let checked = 0;
    for (const t of spheroidTriangles(spec))
      for (const g of decode(t)) {
        const p: [number, number, number] = [(g[0] - 6) * CELL, (g[1] - 6) * CELL, (g[2] - 6) * CELL];
        expect(uOf(p, spec), 'vertex snapped INSIDE the ellipsoid').toBeGreaterThanOrEqual(1);
        checked++;
      }
    expect(checked).toBeGreaterThan(80);
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

  test('skin stays near the surface and scales cheaply', () => {
    const spec = sphere(2, { center: [0, 1.25, 0] });
    for (const t of spheroidTriangles(spec))
      for (const g of decode(t)) {
        const p: [number, number, number] = [(g[0] - 6) * CELL, (g[1] - 6) * CELL, (g[2] - 6) * CELL];
        expect(Math.abs(uOf(p, spec) - 1)).toBeLessThan(0.3);
      }
    // a zeppelin: 16 × 4 × 4 m skin stays in the hundreds, not tens of thousands
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

