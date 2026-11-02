// engine/__tests__/import.test.ts — the EXTERNAL MODEL QUANTISER laws
// (docs/IMPORT-3D.md; the PREVIEW LAW: one quantiser for preview + commit).
//
// Pure tier: lattice maths, voxel parity, greedy merge, window law, honest
// counts. No DOM/WebGL (the preview dialog's e2e tier owns the canvas).

import { describe, it, expect } from 'vitest';
import {
  normalise, snap, voxelize, shellOf, greedyBoxes, emitBlocks, emitSkin,
  decimate, runImport, slotForLinear, IMPORT_DEFAULTS,
} from '../import';
import type { ImportOptions, SrcMesh } from '../import';
import { CELL } from '../format';
import { DEFAULT_PALETTE } from '../palette';

const OPT: ImportOptions = { ...IMPORT_DEFAULTS };

/** Axis box soup in metres, corners (x0,y0,z0)→(x1,y1,z1), 12 tris. */
function cube(x0: number, y0: number, z0: number, x1: number, y1: number,
  z1: number): Float32Array {
  const V = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const F = [
    [0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6], [4, 0, 3], [4, 3, 7],
    [1, 5, 6], [1, 6, 2], [3, 2, 6], [3, 6, 7], [4, 5, 1], [4, 1, 0],
  ];
  const out = new Float32Array(F.length * 9);
  F.forEach((t, i) => t.forEach((v, k) =>
    out.set(V[v]!, i * 9 + k * 3)));
  return out;
}

const src = (pos: Float32Array): SrcMesh => ({ pos });

/** Icosphere-ish soup: subdivided octahedron radius r (n = subdivisions). */
function sphere(r: number, subdiv: number): Float32Array {
  let V: [number, number, number][] = [
    [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1],
  ].map(a => a.map(v => (v / Math.sqrt(3)) * r) as [number, number, number]);
  let T: [number, number, number][] = [[0, 1, 2], [0, 3, 1], [2, 3, 0], [1, 3, 2]];
  for (let s = 0; s < subdiv; s++) {
    const T2: [number, number, number][] = [];
    const mid = (a: [number, number, number], b: [number, number, number]) => {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const L = Math.hypot(m[0]!, m[1]!, m[2]!);
      return m.map(v => (v / L) * r) as [number, number, number];
    };
    for (const [a, b, c] of T) {
      const A = V[a]!, B = V[b]!, C = V[c]!;
      const ab = mid(A, B), bc = mid(B, C), ca = mid(C, A);
      V.push(ab, bc, ca);
      const iab = V.length - 3, ibc = V.length - 2, ica = V.length - 1;
      T2.push([a, iab, ica], [iab, b, ibc], [ica, ibc, c], [iab, ibc, ica]);
    }
    T = T2;
  }
  const out = new Float32Array(T.length * 9);
  T.forEach((t, i) => t.forEach((v, k) => out.set(V[v]!, i * 9 + k * 3)));
  return out;
}

describe('normalise — axis map, span fit, centre, g units', () => {
  const c = src(cube(-1, -1.5, -2, 1, 1.5, 2));   // 2×3×4 m, longest = z
  it('fits the LONGEST axis to span cells', () => {
    const r = normalise([c], { ...OPT, span: 24, up: 'y' });
    const g = r.gpos;
    const rng = (a: number) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i < g.length; i += 3) {
        lo = Math.min(lo, g[i]!); hi = Math.max(hi, g[i]!);
      }
      return hi - lo;
    };
    expect(rng(2)).toBeCloseTo(24, 6);            // z was longest → 24 cells
    expect(rng(0)).toBeCloseTo(12, 6);            // 2 m → 12 cells
  });
  it('maps a z-up source: world height comes from the source z', () => {
    const r = normalise([src(cube(0, 0, 0, 2, 1, 3))], { ...OPT, up: 'z' });
    // world (x, y, z) = (x, z, y): y extent = 3 m scaled, z extent = 1 m
    const spanOf = (a: number) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = a; i < r.gpos.length; i += 3) {
        lo = Math.min(lo, r.gpos[i]!); hi = Math.max(hi, r.gpos[i]!);
      }
      return hi - lo;
    };
    expect(spanOf(1)).toBeGreaterThan(spanOf(2)); // world y (from src z) > z
  });
  it('centres on the lattice centre g=6', () => {
    const r = normalise([src(cube(100, 0, 0, 102, 2, 2))], { ...OPT, span: 8 });
    let sx = 0, sy = 0, sz = 0;
    for (let i = 0; i < r.gpos.length; i += 3) { sx += r.gpos[i]!; sy += r.gpos[i + 1]!; sz += r.gpos[i + 2]!; }
    const n = r.gpos.length / 3;
    expect(sx / n).toBeCloseTo(6, 3);
    expect(sz / n).toBeCloseTo(6, 3);
  });
  it('offset shifts the whole model in integer cells', () => {
    const a = normalise([c], { ...OPT, span: 24 });
    const b = normalise([c], { ...OPT, span: 24, offset: [10, 0, 0] });
    expect(b.gpos[0]! - a.gpos[0]!).toBeCloseTo(10, 9);
  });
});

describe('decimate — meshoptimizer QEM', () => {
  it('honours the budget on a dense sphere', async () => {
    const s = sphere(6, 3);                        // 512 tris
    const r = await decimate(s, null, 100);
    expect(r.tris).toBeGreaterThan(40);
    expect(r.tris).toBeLessThanOrEqual(110);
  });
  it('is a no-op under budget', async () => {
    const r = await decimate(cube(0, 0, 0, 1, 1, 1), null, 3000);
    expect(r.tris).toBe(12);
  });
});

describe('voxelize — SDF flood parity', () => {
  it('fills a snapped cube EXACTLY (solid 24³ cells)', () => {
    const nm = normalise([src(cube(-1, -1, -1, 1, 1, 1))], { ...OPT, span: 24 });
    const g = snap(nm.gpos, null);
    expect(g.n).toBe(12);
    const v = voxelize(g.tris, g.n, 128);
    if (!v.ok) throw new Error(v.reason);
    expect(v.v.cells).toBe(24 * 24 * 24);
  });
  it('shell mode keeps the boundary only', () => {
    const nm = normalise([src(cube(-1, -1, -1, 1, 1, 1))], { ...OPT, span: 24 });
    const g = snap(nm.gpos, null);
    const v = voxelize(g.tris, g.n, 128);
    if (!v.ok) throw new Error(v.reason);
    const sh = shellOf(v.v);
    expect(sh.cells).toBe(24 ** 3 - 22 ** 3);      // 13824 − 10648
  });
  it('refuses an over-cap grid honestly', () => {
    const nm = normalise([src(cube(-1, -1, -1, 1, 1, 1))], { ...OPT, span: 24 });
    const g = snap(nm.gpos, null);
    const v = voxelize(g.tris, g.n, 8);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/too large/);
  });
});

describe('greedyBoxes — merge identity + storage caps', () => {
  const vol = (boxes: { s: [number, number, number] }[]) =>
    boxes.reduce((s, b) => s + (b.s[0] + 1) * (b.s[1] + 1) * (b.s[2] + 1), 0);
  it('volume identity: boxes cover every voxel, shell cube ≤ 8 boxes', () => {
    const nm = normalise([src(cube(-1, -1, -1, 1, 1, 1))], { ...OPT, span: 24 });
    const g = snap(nm.gpos, null);
    const v = voxelize(g.tris, g.n, 128);
    if (!v.ok) throw new Error(v.reason);
    const sh = shellOf(v.v);
    const boxes = greedyBoxes(sh);
    expect(vol(boxes)).toBe(sh.cells);
    expect(boxes.length).toBeLessThanOrEqual(8);   // 6 slabs + greedy slack
    expect(boxes.length).toBeLessThan(sh.cells);   // the merge WORKS
  });
  it('solid cube = 1 box; caps keep size ≤ 24', () => {
    const nm = normalise([src(cube(0, 0, 0, 1, 1, 1))], { ...OPT, span: 4 });
    const g = snap(nm.gpos, null);
    const v = voxelize(g.tris, g.n, 128);
    if (!v.ok) throw new Error(v.reason);
    expect(v.v.cells).toBe(64);
    const boxes = greedyBoxes(v.v);
    expect(boxes.length).toBe(1);
    expect(vol(boxes)).toBe(64);
  });
  it('a 30-cell cube splits at the size cap (all sizes ≤ 24)', () => {
    const nm = normalise([src(cube(-1, -1, -1, 1, 1, 1))], { ...OPT, span: 30 });
    const g = snap(nm.gpos, null);
    const v = voxelize(g.tris, g.n, 128);
    if (!v.ok) throw new Error(v.reason);
    const boxes = greedyBoxes(v.v);
    expect(vol(boxes)).toBe(30 ** 3);
    for (const b of boxes)
      for (const s of b.s) expect(s).toBeLessThanOrEqual(24);
    expect(boxes.length).toBeGreaterThan(1);
  });
});

describe('emitBlocks — the storage law', () => {
  it('every record obeys pos_* ∈ 0..12 and size ≤ 24', () => {
    const nm = normalise([src(cube(-1, -1, -1, 1, 1, 1))], { ...OPT, span: 30 });
    const g = snap(nm.gpos, null);
    const v = voxelize(g.tris, g.n, 128);
    if (!v.ok) throw new Error(v.reason);
    for (const b of emitBlocks(greedyBoxes(shellOf(v.v)), 7, 0)) {
      expect(b.pos_x).toBeGreaterThanOrEqual(0);
      expect(b.pos_x).toBeLessThanOrEqual(12);
      expect(b.pos_y).toBeGreaterThanOrEqual(0);
      expect(b.pos_z).toBeGreaterThanOrEqual(0);
      expect(b.size_x).toBeLessThanOrEqual(24);
      expect(b.type).toBe(0);
      expect(b.colors).toEqual([7, 7, 7, 7, 7, 7, 7]);
    }
  });
});

describe('emitSkin — the pinned window chain', () => {
  it('closed cube: 12 records, ZERO non-manifold edges', () => {
    const nm = normalise([src(cube(-1, -1, -1, 1, 1, 1))], { ...OPT, span: 24 });
    const g = snap(nm.gpos, null);
    const r = emitSkin(g, { ...OPT, perTriColor: false, slot: 7 });
    expect(r.triangles.length).toBe(12);
    expect(r.skipped).toBe(0);
    expect(r.nmEdges.length).toBe(0);
    // the window law: v ∈ 0..31 in every record
    for (const t of r.triangles)
      for (const ax of ['x', 'y', 'z'] as const) {
        const f = t[`frame_${ax}`] as number;
        for (let i = 0; i < 3; i++) {
          const v = t[`v${i}_${ax}`] as number;
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(31);
          void f;
        }
      }
  });
  it('a 40-cell face is RESCUED by splitFace (window overflow is never silent)', () => {
    // g-space directly: one triangle spanning 40 cells in x and z
    const pos = new Float32Array([6, 6, 6, 46, 6, 6, 6, 6, 46]);
    const g = snap(pos, null);
    const r = emitSkin(g, { ...OPT, perTriColor: false, slot: 7 });
    expect(r.rescued).toBe(1);
    expect(r.triangles.length).toBe(4);           // 1 → 4 midpoint recut
    expect(r.skipped).toBe(0);
  });
  it('two cubes sharing a face report non-manifold edges', () => {
    // g-space: two 4-cell cubes stacked on a shared plane
    const a = cube(6, 6, 6, 10, 10, 10), b = cube(6, 10, 6, 10, 14, 10);
    const pos = new Float32Array(a.length + b.length);
    pos.set(a, 0); pos.set(b, a.length);
    const g = snap(pos, null);
    const r = emitSkin(g, { ...OPT, perTriColor: false, slot: 7 });
    expect(r.nmEdges.length / 6).toBeGreaterThanOrEqual(4);
  });
});

describe('palette quantiser', () => {
  it('maps pure red to a red-dominant slot, blue to a blue-dominant slot', () => {
    const red = slotForLinear(1, 0, 0), blue = slotForLinear(0, 0, 1);
    expect(red).not.toBe(blue);
    const R = DEFAULT_PALETTE[red], B = DEFAULT_PALETTE[blue];
    expect(R!.r).toBeGreaterThan(120);
    expect(B!.b).toBeGreaterThan(R!.b);
  });
});

describe('runImport — end to end', () => {
  it('blocks mode: honest stats on the shell cube', async () => {
    const r = await runImport([src(cube(-1, -1, -1, 1, 1, 1))],
      { ...OPT, span: 24, decimate: false, shell: true });
    expect(r.ok).toBe(true);
    expect(r.stats.cells).toBe(24 ** 3 - 22 ** 3);
    expect(r.stats.blocks).toBeGreaterThan(0);
    expect(r.blocks.length).toBe(r.stats.blocks);
    // mass identity: cells × density[0] (composite 0.25 kg/cell)
    expect(r.stats.massKg).toBeCloseTo((24 ** 3 - 22 ** 3) * 0.25, 6);
  });
  it('skin mode: closed soup → zero non-manifold + >0 mass', async () => {
    const r = await runImport([src(cube(-1, -1, -1, 1, 1, 1))],
      { ...OPT, span: 24, decimate: false, mode: 'skin', perTriColor: false });
    expect(r.ok).toBe(true);
    expect(r.stats.skinTris).toBe(12);
    expect(r.stats.nonManifold).toBe(0);
    expect(r.stats.massKg).toBeGreaterThan(0);
    // tri mass identity: side 6 m cube: 6 faces × 36 m² = 216 m² skin
    expect(r.stats.massKg).toBeCloseTo(216 * 0.05 / (CELL ** 3) * 0.25, 1);
  });
  it('empty input is an honest refusal', async () => {
    const r = await runImport([], { ...OPT, span: 2 });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/no triangles/);
  });
});
