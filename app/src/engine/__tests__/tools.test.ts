// tools.ts pins (v1.7): the MATERIALS table + custom-RGB palette helpers,
// the REPLACE-ALL census/mutation (family finish mapping, occupancy mirrors
// never touched) and HULLIFY — blocks ▸ the hull triangles that cover their
// OUTSIDE surface exactly. The invariant that makes hullify safe: the merged
// triangle set covers the SAME surface area as cull.ts's surviving faces
// (the exact silhouette), keeps each piece's colour + material, and lands on
// the cell-corner lattice inside the game's 0..31 vertex window.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { corpusDir } from '../../../tools/vite-corpus.ts';
import {
  MATERIALS, allocateSlot, freePaletteSlots, hullifyApply, hullifyPreview,
  nearestSlot, parseHexColor, replaceAll, replaceCensus, replaceSources,
} from '../tools';
import { culledBlocksSolids } from '../cull';
import type { Block, Blueprint, Triangle } from '../format';
import { CELL } from '../format';
import type { FilePalette } from '../palette';

const block = (o: Partial<Block> & { pos_x: number; pos_y: number; pos_z: number }): Block => ({
  type: 0, size_x: 0, size_y: 0, size_z: 0, frame_x: 0, frame_y: 0, frame_z: 0, material: 0, ...o,
});
const all = (slot: number) => [slot, slot, slot, slot, slot, slot, slot];

const bpOf = (blocks: Block[], extra: Partial<Blueprint['data']> = {}): Blueprint => ({
  box_min: { x: -1, y: -1, z: -1 }, box_max: { x: 1, y: 1, z: 1 },
  data: { version: 2, blocks, components: [], colors: [], ...extra },
});

/** world metres of a stored triangle vertex (exact lattice maths). */
const triWorld = (t: Triangle): [number, number, number][] => {
  const o = t as unknown as Record<string, number>;
  return [0, 1, 2].map(i => [
    (o[`v${i}_x`]! + 12 * (t.frame_x ?? 0) - 6) * CELL,
    (o[`v${i}_y`]! + 12 * (t.frame_y ?? 0) - 6) * CELL,
    (o[`v${i}_z`]! + 12 * (t.frame_z ?? 0) - 6) * CELL,
  ]) as [number, number, number][];
};
const triArea = (p: [number, number, number][]): number => {
  const e1 = p[1]!.map((x, i) => x - p[0]![i]!);
  const e2 = p[2]!.map((x, i) => x - p[0]![i]!);
  const cr: [number, number, number] = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  return Math.hypot(cr[0], cr[1], cr[2]) / 2;
};
const areaSum = (tris: [number, number, number][][]): number =>
  tris.reduce((s, t) => s + triArea(t), 0);

describe('materials + RGB helpers', () => {
  test('the seven build materials, in the file order (FORMAT §blocks)', () => {
    expect(MATERIALS).toEqual(['Composite', 'Concrete', 'Steel', 'Aluminium',
      'Glass', 'Lead', 'Titanium']);
  });
  test('parseHexColor: #rrggbb in any case, malformed refused', () => {
    expect(parseHexColor('#7f00FF')).toEqual({ r: 127, g: 0, b: 255 });
    expect(parseHexColor('ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(parseHexColor('#fff')).toBeNull();
    expect(parseHexColor('zzzzzz')).toBeNull();
  });
  test('nearestSlot picks the closest OCCUPIED slot (built-ins fill the gaps)', () => {
    expect(nearestSlot([], { r: 255, g: 255, b: 255 })).toBe(0);
    expect(nearestSlot([], { r: 200, g: 200, b: 200 })).toBe(5);       // engine chrome
    const pal: FilePalette = [];
    pal[200] = { r: 250, g: 10, b: 10, opacity: 15, roughness: 0, metallic: 0 };
    expect(nearestSlot(pal, { r: 245, g: 12, b: 8 })).toBe(200);
  });
  test('allocateSlot / freePaletteSlots: engine slots 0..10 are never free', () => {
    expect(allocateSlot([])).toBe(11);
    const pal: FilePalette = [];
    for (let s = 11; s < 256; s++) pal[s] = { r: 1, g: 1, b: 1, opacity: 15, roughness: 0, metallic: 0 };
    expect(allocateSlot(pal)).toBeNull();
    expect(freePaletteSlots([]).length).toBeGreaterThan(100);
    expect(freePaletteSlots([]).every(s => s >= 11)).toBe(true);
  });
});

describe('replaceAll', () => {
  const metal = replaceSources('material').find(s => s.id === 'm2')!;

  test('material target: census + swap, other materials untouched', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, material: 2, colors: all(51) }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, material: 2, colors: all(51) }),
      block({ pos_x: 7, pos_y: 5, pos_z: 5, material: 0, colors: all(51) }),
    ]);
    expect(replaceCensus(bp, metal, 'material').blocks).toBe(2);
    const res = replaceAll(bp, metal, 'material', undefined, 4);
    expect(res.blocks).toBe(2);
    expect(bp.data.blocks.map(b => b.material)).toEqual([4, 4, 0]);
  });

  test('colour target: the METAL family → GLASS family keeps each colour (in-family map)', () => {
    // metal family slots 128..144 (white, 64 grey, 4 dark, red…): 128 → glass 172
    const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: [128, 129, 130, 131, 132, 133, 134] })]);
    const steel = replaceSources('colors').find(s => s.id === 'metal')!;
    expect(replaceCensus(bp, steel, 'colors').faces).toBe(7);
    const res = replaceAll(bp, steel, 'colors', s => 172 + (s - 128));
    expect(res.faces).toBe(7);
    expect(bp.data.blocks[0]!.colors).toEqual([172, 173, 174, 175, 176, 177, 178]);
  });

  test('type-255 occupancy mirrors are NEVER repainted or re-materialled', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(128), material: 2 }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, type: 255, colors: all(128), material: 2 }),
    ]);
    expect(replaceCensus(bp, metal, 'material').blocks).toBe(1);
    replaceAll(bp, metal, 'material', undefined, 4);
    expect(bp.data.blocks[1]!.material).toBe(2);
    const steel = replaceSources('colors').find(s => s.id === 'metal')!;
    replaceAll(bp, steel, 'colors', s => 172 + (s - 128));
    expect(bp.data.blocks[1]!.colors).toEqual(all(128));
  });

  test('"metal chrome" source covers engine slots 5..10 AND the metal family', () => {
    const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: [5, 10, 128, 144, 84, 0, 4] })]);
    const look = replaceSources('colors').find(s => s.id === 'metallook')!;
    expect(replaceCensus(bp, look, 'colors').faces).toBe(4);
  });
});

describe('hullify — blocks ▸ hull triangles', () => {
  test('two glued cubes merge into ONE closed box: 12 triangles, exact area', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3), material: 2 }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(3), material: 2 }),
    ]);
    const prev = hullifyPreview(bp);
    expect(prev.ok).toBe(true);
    expect(prev.blocksRemoved).toBe(2);
    // a 2×1×1-cell box: six merged rectangles = 12 triangles
    expect(prev.trisAdded).toBe(12);
    // preview never mutates
    expect(bp.data.blocks.length).toBe(2);
    expect(bp.data.triangles ?? []).toEqual([]);

    const res = hullifyApply(bp);
    expect(res.trisAdded).toBe(12);
    expect(bp.data.blocks.length).toBe(0);
    const tris = bp.data.triangles!;
    // the box 0.5 × 0.25 × 0.25 m: surface 0.625 m² — the SAME area cull shows
    const culled = culledBlocksSolids([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3), material: 2 }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(3), material: 2 }),
    ], null, false);
    expect(areaSum(tris.map(triWorld))).toBeCloseTo(
      areaSum(culled.tris.map(t => t.tri)), 9);
    // every face keeps the block's colour + material on all five prism faces
    for (const t of tris) {
      expect(t.colors).toEqual([3, 3, 3, 3, 3]);
      expect(t.material).toBe(2);
    }
  });

  test('a 13-cube row glues into ONE prism (12 tris), not 13 boxes — cross-block merge', () => {
    const blocks = Array.from({ length: 13 }, (_, i) =>
      block({ pos_x: 2 + i, pos_y: 5, pos_z: 5, colors: all(3) }));
    // crosses a frame boundary (cells 2..14) → the writer re-anchors frames
    blocks[12]!.pos_x = 2; blocks[12]!.frame_x = 1;
    const res = hullifyPreview(bpOf(blocks));
    expect(res.trisAdded).toBe(12);
    expect(res.skipped).toBe(0);
  });

  test('different colours do NOT merge across the seam (the finish stays)', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(48) }),
    ]);
    const res = hullifyPreview(bp);
    // same COUNT as the single-colour pair (the seam faces are culled either
    // way), but every face stayed its own quad: an all-one-colour pair merges
    // its 10 surviving quads down to 6 rects = 12 triangles — here none did.
    expect(res.trisAdded).toBe(20);
    hullifyApply(bp);
    // no merged rectangle survived: every triangle pair spans exactly 1 cell
    for (const t of bp.data.triangles!) {
      const w = triWorld(t);
      for (const a of [0, 1, 2] as const)
        expect(Math.max(...w.map(p => p[a]!)) - Math.min(...w.map(p => p[a]!))).toBeLessThanOrEqual(CELL + 1e-9);
    }
    // both colours survived, five prism faces each
    expect(new Set(bp.data.triangles!.flatMap(t => t.colors ?? [])).size).toBe(2);
  });

  test('different MATERIALS do not merge either — each piece keeps its block material', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3), material: 0 }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(3), material: 5 }),
    ]);
    const res = hullifyPreview(bp);
    expect(res.trisAdded).toBeGreaterThan(12);
    hullifyApply(bp);
    const mats = new Set(bp.data.triangles!.map(t => t.material));
    expect([...mats].sort()).toEqual([0, 5]);
  });

  test('vertices land on the lattice, in the game 0..31 window, frames floorDiv', () => {
    const blocks = Array.from({ length: 6 }, (_, i) =>
      block({ pos_x: 3 + i, pos_y: 4, pos_z: 5, colors: all(51) }));
    const bp = bpOf(blocks);
    hullifyApply(bp);
    for (const t of bp.data.triangles!) {
      const o = t as unknown as Record<string, number>;
      for (const ax of ['x', 'y', 'z'] as const) {
        const f = o[`frame_${ax}`] ?? 0;

        expect(Number.isInteger(f)).toBe(true);
        for (let i = 0; i < 3; i++) {
          const v = o[`v${i}_${ax}`]!;
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(31);
          expect(v + 12 * f).toBeGreaterThanOrEqual(0 + 12 * f);   // min-anchored
        }
      }
      // world positions are exact 0.25 multiples
      for (const p of triWorld(t))
        for (const c of p) expect(Math.abs(c / CELL - Math.round(c / CELL))).toBeLessThan(1e-9);
    }
  });

  test('slopes: the slant faces survive with their own colour + the diagonal plane merges', () => {
    const blocks = [
      block({ type: 1, pos_x: 5, pos_y: 5, pos_z: 5, colors: [9, 3, 3, 3, 3, 3, 3] }),
      block({ type: 1, pos_x: 6, pos_y: 5, pos_z: 5, colors: [9, 3, 3, 3, 3, 3, 3] }),
    ];
    const culled = culledBlocksSolids(blocks, null, false);
    const bp = bpOf(blocks);
    const res = hullifyPreview(bp);
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe(0);
    hullifyApply(bp);
    expect(areaSum(bp.data.triangles!.map(triWorld))).toBeCloseTo(
      areaSum(culled.tris.map(t => t.tri)), 9);
    // the slant colour (slot 9) survived on at least one triangle
    expect(bp.data.triangles!.some(t => t.colors?.[0] === 9)).toBe(true);
  });

  test('bbox preserved: the triangle hull matches the culled block surface box', () => {
    const blocks = [
      block({ pos_x: 4, pos_y: 5, pos_z: 4, size_x: 3, size_z: 2, colors: all(3) }),
      block({ type: 21, pos_x: 8, pos_y: 5, pos_z: 4, colors: all(3) }),
    ];
    const culled = culledBlocksSolids(blocks, null, false);
    const cbox = (pts: [number, number, number][]): [[number, number, number], [number, number, number]] => {
      const lo: [number, number, number] = [Infinity, Infinity, Infinity];
      const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
      for (const q of pts) for (const a of [0, 1, 2] as const) {
        lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]);
      }
      return [lo, hi];
    };
    const bp = bpOf(blocks);
    hullifyApply(bp);
    const [clo, chi] = cbox(culled.tris.flatMap(t => t.tri));
    const [tlo, thi] = cbox(bp.data.triangles!.flatMap(triWorld));
    for (const a of [0, 1, 2] as const) {
      expect(tlo[a]).toBeCloseTo(clo[a], 6);
      expect(thi[a]).toBeCloseTo(chi[a], 6);
    }
  });

  test('occupancy mirrors SURVIVE the conversion; existing triangles are kept', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, type: 255, colors: all(0) }),
    ], { triangles: [] });
    const res = hullifyApply(bp);
    expect(res.keptOcc).toBe(1);
    expect(bp.data.blocks.length).toBe(1);
    expect(bp.data.blocks[0]!.type).toBe(255);
  });

  test('refusal: nothing to convert (empty / occupancy-only)', () => {
    expect(hullifyPreview(bpOf([])).ok).toBe(false);
    expect(hullifyPreview(bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, type: 255, colors: all(0) })])).ok).toBe(false);
  });

  test('SUBGRID blocks stay blocks (nested lists are not rewritten) and are reported', () => {
    const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) })]);
    // a Build component carrying its own nested block list (the door panel)
    (bp.data.components as unknown as Record<string, unknown>[]).push({
      type: 'Build', position: { x: 0, y: 0, z: 0 }, orientation: { w: 1, x: 0, y: 0, z: 0 },
      data: { blocks: [block({ pos_x: 4, pos_y: 4, pos_z: 4, colors: all(3) })], components: [] },
    });
    bp.data.composite_builds = [{ component: 0, slaveBuildId: 0 }];
    const r = hullifyPreview(bp);
    expect(r.ok).toBe(true);
    expect(r.subBlocks).toBe(1);
    hullifyApply(bp);
    expect(bp.data.blocks.length).toBe(0);
    const nested = (bp.data.components[0] as unknown as { data: { blocks: unknown[] } }).data.blocks;
    expect(nested.length).toBe(1);                                     // untouched
  });

  test('mass estimate: the shell is lighter than the solid blocks it replaces', () => {
    const blocks = Array.from({ length: 27 }, (_, i) => {
      const x = i % 3, y = Math.floor(i / 3) % 3, z = Math.floor(i / 9);
      return block({ pos_x: 4 + x, pos_y: 4 + y, pos_z: 4 + z, colors: all(3), material: 2 });
    });
    const r = hullifyPreview(bpOf(blocks));
    expect(r.blocksRemoved).toBe(27);
    expect(r.massRemoved).toBeGreaterThan(r.massAdded);   // steel 3×3×3 vs its skin
    expect(r.massAdded).toBeGreaterThan(0);
  });

  test('CORPUS SMOKE: every block craft converts, area EXACTLY = the culled surface', () => {
    const CORPUS = corpusDir();
    if (!existsSync(CORPUS)) return;
    const dirs = readdirSync(CORPUS).filter(d => {
      try { return statSync(`${CORPUS}/${d}/blueprint.json`).isFile(); } catch { return false; }
    });
    let checked = 0;
    for (const d of dirs) {
      if (!/^\d+$/.test(d)) continue;
      const bp = JSON.parse(readFileSync(`${CORPUS}/${d}/blueprint.json`, 'utf8')) as Blueprint;
      if (!bp.data.blocks?.length) continue;
      if (!bp.data.blocks.some(b => b.type !== 255)) continue;      // occupancy-only craft
      const res = hullifyPreview(bp);
      expect(res.ok, d).toBe(true);
      // nested Build blocks are never part of the top-level rewrite
      const nested = (bp.data.components ?? []).reduce((n, c) => n
        + ((((c as unknown as { data?: { blocks?: unknown[] } }).data?.blocks)?.length) ?? 0), 0);
      expect(res.subBlocks, d).toBe(nested);
      expect(res.skipped, d).toBe(0);
      const culled = culledBlocksSolids(bp.data.blocks, bp.data.colors ?? null, !bp.data.colors);
      const culledArea = culled.tris.reduce((acc, t) => {
        const p0 = t.tri[0]!, p1 = t.tri[1]!, p2 = t.tri[2]!;
        const e1 = [p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!];
        const e2 = [p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!];
        const cr: [number, number, number] = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
        return acc + Math.hypot(cr[0], cr[1], cr[2]) / 2;
      }, 0);
      // the probe keeps the craft's OWN palette so the cull/translucency rules
      // on both sides of the comparison are identical
      const probe = bpOf(bp.data.blocks, { colors: bp.data.colors });
      probe.data.triangles = [];
      hullifyApply(probe);
      expect(areaSum(probe.data.triangles!.map(triWorld)), d)
        .toBeCloseTo(culledArea, 6);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
