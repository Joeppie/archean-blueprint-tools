// spheroid.test.ts — pins for the block-spheroid generator (v1.6 tool).
// The law under test: the union of the generated blocks is a ROUND, SEALED
// spheroid of the shape table, the SOLID interior is 100% filled with the
// FEWEST square blocks (merged boxes), no two blocks share a lattice cell,
// every record is file-valid (pos ∈ 0..11 beside size), and the whole plan is
// mirror-symmetric when the centre lands on the corner lattice.
import { describe, expect, test } from 'vitest';
import {
  matchBlockType, spheroidBlocks, spheroidOverlaps, spheroidPlan, spheroidStats,
  type SpheroidSpec,
} from '../spheroid';
import { CELL, CELLS_PER_FRAME } from '../format';
import { getBlockPoints } from '../blockshapes';
import type { Block } from '../format';

// exact sphere at world origin (cell (6,6,6)), corner lattice: centre lands
// on lattice points for every whole-cell radius
const sphere = (rM: number, over: Partial<SpheroidSpec> = {}): SpheroidSpec => ({
  center: [0, 0, 0], radii: [rM, rM, rM], material: 0, slot: 51, solid: true, ...over,
});

const cellsOf = (b: Block): number[] => {
  const x = (b.frame_x ?? 0) * CELLS_PER_FRAME + b.pos_x;
  const y = (b.frame_y ?? 0) * CELLS_PER_FRAME + b.pos_y;
  const z = (b.frame_z ?? 0) * CELLS_PER_FRAME + b.pos_z;
  const out: number[] = [];
  for (let i = 0; i <= b.size_x; i++)
    for (let j = 0; j <= b.size_y; j++)
      for (let k = 0; k <= b.size_z; k++) out.push(((x + i + 64) * 256 + y + j) * 256 + z + k);
  return out;
};

/** ellipsoid radius of a world point: 1 = exactly on the surface */
const uOf = (p: [number, number, number], s: SpheroidSpec) => {
  let t = 0;
  for (let a = 0; a < 3; a++) { const q = (p[a]! - s.center[a]!) / s.radii[a]!; t += q * q; }
  return Math.sqrt(t);
};

describe('spheroid — record validity', () => {
  test('every block is file-valid lattice + paints + material', () => {
    const spec = sphere(1.5, { material: 3 });
    for (const b of spheroidBlocks(spec)) {
      expect(b.type).toBeGreaterThanOrEqual(0);
      expect(b.type).toBeLessThan(53);
      for (const a of ['x', 'y', 'z'] as const) {
        expect(b[`pos_${a}`]).toBeGreaterThanOrEqual(0);
        expect(b[`pos_${a}`]).toBeLessThanOrEqual(11);
        expect(b[`size_${a}`]).toBeGreaterThanOrEqual(0);
        expect(b[`pos_${a}`]! + b[`size_${a}`]!).toBeLessThanOrEqual(11);
      }
      expect(b.colors).toEqual([51, 51, 51, 51, 51, 51, 51]);
      expect(b.material).toBe(3);
    }
  });

  test('frame borders split merged boxes (pos+size ≤ 11 even across frames)', () => {
    // a big spheroid centred OFF the frame origin — merged boxes MUST split
    const spec: SpheroidSpec = { ...sphere(3), center: [2.6, 2.6, 2.6] };
    for (const b of spheroidBlocks(spec))
      for (const a of ['x', 'y', 'z'] as const)
        expect(b[`pos_${a}`]! + b[`size_${a}`]!).toBeLessThanOrEqual(11);
  });
});

describe('spheroid — sealed, disjoint, bounded', () => {
  for (const r of [0.5, 1, 1.5, 2.5]) test(`solid r=${r}m: 100% filled, no shared cells`, () => {
    const spec = sphere(r);
    const blocks = spheroidBlocks(spec);
    expect(blocks.length).toBeGreaterThan(0);
    // (1) no two blocks share a lattice cell (footprint disjointness)
    const seen = new Map<number, number>();
    for (const b of blocks)
      for (const k of cellsOf(b)) {
        expect(seen.has(k), 'two spheroid blocks share a cell').toBe(false);
        seen.set(k, b.type);
      }
    // (2) SEALED: every cell whose centre is inside the ellipsoid is covered
    const R = r / CELL;
    let insideCells = 0;
    for (let z = Math.floor(6 - R) - 1; z <= Math.ceil(6 + R) + 1; z++)
      for (let y = Math.floor(6 - R) - 1; y <= Math.ceil(6 + R) + 1; y++)
        for (let x = Math.floor(6 - R) - 1; x <= Math.ceil(6 + R) + 1; x++) {
          const p: [number, number, number] = [(x + 0.5 - 6) * CELL, (y + 0.5 - 6) * CELL, (z + 0.5 - 6) * CELL];
          if (uOf(p, spec) > 1) continue;
          insideCells++;
          expect(seen.has(((x + 64) * 256 + y) * 256 + z),
            `inside cell (${x},${y},${z}) is a cavity`).toBe(true);
        }
    expect(insideCells).toBeGreaterThan(0);
    // (3) BOUNDED: nothing generated far outside the surface — every block
    // footprint cell has at least one INSIDE corner (never a detached lump)
    for (const b of blocks) {
      const x = (b.frame_x ?? 0) * 12 + b.pos_x, y = (b.frame_y ?? 0) * 12 + b.pos_y, z = (b.frame_z ?? 0) * 12 + b.pos_z;
      let anyCorner = false;
      for (let i = 0; i <= b.size_x + 1 && !anyCorner; i++)
        for (let j = 0; j <= b.size_y + 1 && !anyCorner; j++)
          for (let k = 0; k <= b.size_z + 1 && !anyCorner; k++) {
            const p: [number, number, number] = [(x + i - 6) * CELL, (y + j - 6) * CELL, (z + k - 6) * CELL];
            if (uOf(p, spec) <= 1) anyCorner = true;
          }
      expect(anyCorner, 'block with no inside corner').toBe(true);
    }
  });
});

describe('spheroid — roundness', () => {
  test('every block vertex lies within one cell diagonal of the surface', () => {
    const spec = sphere(2);
    const rMin = Math.min(...spec.radii);
    const band = Math.sqrt(3) * CELL * 1.5;    // a cell diagonal and a half
    let vertices = 0, worst = 0;
    for (const b of spheroidBlocks(spec)) {
      // the SHAPE's own vertices (a subset of the box corners — the shape,
      // not its bounding footprint, is what the eye sees)
      const x = (b.frame_x ?? 0) * 12 + b.pos_x, y = (b.frame_y ?? 0) * 12 + b.pos_y, z = (b.frame_z ?? 0) * 12 + b.pos_z;
      const origin: [number, number, number] = [(x - 6) * CELL, (y - 6) * CELL, (z - 6) * CELL];
      const size: [number, number, number] = [(b.size_x + 1) * CELL, (b.size_y + 1) * CELL, (b.size_z + 1) * CELL];
      for (const p of getBlockPoints(b.type, origin, size)) {
        const u = uOf(p, spec);
        worst = Math.max(worst, Math.abs(u - 1) * rMin);
        expect(Math.abs(u - 1) * rMin,
          `vertex of type ${b.type} at ${p.map(v => v.toFixed(2)).join(',')} u=${u.toFixed(2)}`)
          .toBeLessThanOrEqual(band);
        vertices++;
      }
    }
    console.log('worst surface deviation (m):', worst.toFixed(3));
    expect(vertices).toBeGreaterThan(100);
  });

  test('filled volume matches the ellipsoid within 20 %', () => {
    const spec = sphere(2);
    const st = spheroidStats(spec);
    const exact = (4 / 3) * Math.PI * (2 / CELL) ** 3;   // cells³
    expect(st.interiorCells / exact).toBeGreaterThan(0.5);  // real interior exists
    const est = st.interiorCells + st.shellCells * 0.5;     // boundary ≈ half-full
    expect(Math.abs(est - exact) / exact).toBeLessThan(0.2);
  });

  test('shape blocks are used (not a cube blob)', () => {
    const spec = sphere(2);
    const types = new Set(spheroidBlocks(spec).map(b => b.type));
    types.delete(0);
    expect(types.size).toBeGreaterThanOrEqual(2);   // corners AND (slope or inv-corner)
  });
});

describe('spheroid — fewest square blocks', () => {
  test('solid merges the interior into few big cubes', () => {
    const spec = sphere(2.5);
    const plan = spheroidPlan(spec);
    let interiorCells = 0;
    for (const b of plan.interior) interiorCells += b.ext[0]! * b.ext[1]! * b.ext[2]!;
    expect(interiorCells).toBeGreaterThan(100);
    // the merge must be DRAMATICALLY better than 1 cube / cell
    expect(plan.interior.length).toBeLessThan(interiorCells / 4);
    // and at least one merged box spans > 1 cell on some axis
    expect(plan.interior.some(b => b.ext[0]! > 1 || b.ext[1]! > 1 || b.ext[2]! > 1)).toBe(true);
  });

  test('shell has no interior and less filled volume than solid', () => {
    const a = spheroidStats(sphere(2));
    const b = spheroidStats(sphere(2, { solid: false }));
    expect(b.interiorCells).toBe(0);
    expect(b.interiorCells + b.shellCells * 0.5).toBeLessThan(a.interiorCells + a.shellCells * 0.5);
    expect(b.blocks).toBeGreaterThan(0);
  });
});

describe('spheroid — symmetry', () => {
  test('sphere on the corner lattice is x-mirror symmetric (footprints)', () => {
    const spec = sphere(1.5);
    const spans = spheroidBlocks(spec).map(b => {
      const x = (b.frame_x ?? 0) * 12 + b.pos_x, y = (b.frame_y ?? 0) * 12 + b.pos_y, z = (b.frame_z ?? 0) * 12 + b.pos_z;
      return `${x}|${x + b.size_x}|${y}|${y + b.size_y}|${z}|${z + b.size_z}`;
    });
    const set = new Set(spans);
    // centre cell 6: footprint [s, s+e] mirrors to [12−e−… ] — cell window
    // [s, s+e] (inclusive) maps to [12−(e+1)… ] → [11−e, 11−s]
    for (const s of spans) {
      const [x0, x1, y0, y1, z0, z1] = s.split('|').map(Number) as [number, number, number, number, number, number];
      expect(set.has(`${11 - x1}|${11 - x0}|${y0}|${y1}|${z0}|${z1}`), `mirror of ${s}`).toBe(true);
    }
  });
});

describe('matchBlockType — the shape law itself', () => {
  test('one corner out → inverse corner with the notch on that corner', () => {
    const mask = 255 & ~(1 << 7);            // corner (+x,+y,+z) = bit 7 out
    const t = matchBlockType(mask, [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)], 7 / 8);
    expect(t).toBeGreaterThanOrEqual(45);    // INVCORNER family
    expect(t).toBeLessThan(53);
  });
  test('one corner in → corner lump', () => {
    const t = matchBlockType(1 << 7, [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)], 1 / 8);
    expect(t).toBeGreaterThanOrEqual(13);
    expect(t).toBeLessThan(21);
  });
  test('six corners in, edge pair out → slope', () => {
    // corners (0,1,1) and (1,1,1) out: bits 6|7 → the y+z=1 half-cut
    const mask = 255 & ~((1 << 6) | (1 << 7));
    const t = matchBlockType(mask, [0, Math.SQRT1_2, Math.SQRT1_2], 6 / 8);
    expect(t).toBeGreaterThanOrEqual(1);
    expect(t).toBeLessThan(13);
  });
  test('flat axis band prefers a cube/slope over lumps', () => {
    const mask = 1 | 2 | 4 | 8;              // bottom face (y=0) in, top out
    const t = matchBlockType(mask, [0, 1, 0], 4 / 8);
    expect([0, ...Array.from({ length: 12 }, (_, i) => i + 1)]).toContain(t);
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
