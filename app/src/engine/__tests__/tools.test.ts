// tools.ts pins (v1.7, hullify REWRITTEN v1.5.1 face-exact): the MATERIALS
// table + custom-RGB palette helpers, the REPLACE-ALL census/mutation
// (family finish mapping, occupancy mirrors never touched) and HULLIFY —
// blocks ▸ hull triangles that ARE their own outside faces. The two
// invariants that make hullify safe (the old stitch pass violated the
// second one while keeping the first — the ISW-241 wing butchering):
//  • AREA: the emitted set covers the SAME area as cull.ts's surviving
//    faces (the exact silhouette) for EVERY corpus craft;
//  • CONTAINMENT: EVERY emitted triangle (centroid + all three corners)
//    lies ON that culled surface, in its plane — equal area + containment
//    together = the union is exact. Plus the literal rule: a block's face
//    triangles use the BLOCK SHAPE'S OWN corners (a square face = 2 tris,
//    a wedge side = 1), and a border shared precisely between neighbours
//    emits nothing.
// Colours + materials stay per face, on the cell-corner lattice inside the
// game's 0..31 vertex window.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { corpusDir } from '../../../tools/vite-corpus.ts';
import {
  MATERIALS, allocateSlot, freePaletteSlots, hullifyApply, hullifyPreview,
  nearestSlot, parseHexColor, replaceAll, replaceCensus, replaceSources,
} from '../tools';
import { culledBlocksSolids, blkCell, blkSpan, cellM } from '../cull';
import { getBlockPoints } from '../blockshapes';
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

type V3 = [number, number, number];
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a: V3, b: V3): V3 =>
  [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const gOf = (p: V3): V3 => [Math.round(p[0] / CELL + 6), Math.round(p[1] / CELL + 6), Math.round(p[2] / CELL + 6)];
const gcd2 = (a: number, b: number): number => (b ? gcd2(b, a % b) : Math.abs(a));
/** canonical integer plane key of a world tri (lattice arithmetic, exact) */
function planeKeyOf(t: V3[]): string {
  const g = t.map(gOf);
  const n = vcross(vsub(g[1]!, g[0]!), vsub(g[2]!, g[0]!));
  const d = gcd2(gcd2(n[0], n[1]), n[2]) || 1;
  let [nx, ny, nz] = [n[0] / d, n[1] / d, n[2] / d];
  if (nx < 0 || (nx === 0 && ny < 0) || (nx === 0 && ny === 0 && nz < 0)) { nx = -nx; ny = -ny; nz = -nz; }
  return `${nx},${ny},${nz}|${nx * g[0]![0] + ny * g[0]![1] + nz * g[0]![2]}`;
}
/** coplanar point-in-tri (2D projection on the dominant plane, boundary ok) */
function inTriExact(q: V3, t: V3[]): boolean {
  const n = vcross(vsub(t[1]!, t[0]!), vsub(t[2]!, t[0]!));
  const nl = Math.hypot(n[0], n[1], n[2]);
  if (nl < 1e-12) return false;
  if (Math.abs(n[0] * (q[0] - t[0]![0]) + n[1] * (q[1] - t[0]![1]) + n[2] * (q[2] - t[0]![2])) / nl > 1e-6) return false;
  const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const u = (ax + 1) % 3, v = (ax + 2) % 3;
  const p2 = (p: V3): [number, number] => [p[u]!, p[v]!];
  const A = p2(t[0]!), B = p2(t[1]!), C = p2(t[2]!), Q = p2(q);
  const sgn = (p: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0]);
  const d1 = sgn(A, B, Q), d2 = sgn(B, C, Q), d3 = sgn(C, A, Q);
  const eps = 1e-9 * (Math.hypot(B[0] - A[0], B[1] - A[1]) * Math.hypot(C[0] - A[0], C[1] - A[1]) + 1);
  return !((d1 < -eps || d2 < -eps || d3 < -eps) && (d1 > eps || d2 > eps || d3 > eps));
}
/** emitted tris NOT on the culled surface (plane bucket + centroid/corners) */
function straysOf(out: V3[][], surf: V3[][]): number {
  const buckets = new Map<string, V3[][]>();
  for (const t of surf) {
    const k = planeKeyOf(t);
    const b = buckets.get(k);
    if (b) b.push(t); else buckets.set(k, [t]);
  }
  let n = 0;
  for (const t of out) {
    const bucket = buckets.get(planeKeyOf(t)) ?? [];
    const cen: V3 = [(t[0]![0] + t[1]![0] + t[2]![0]) / 3, (t[0]![1] + t[1]![1] + t[2]![1]) / 3, (t[0]![2] + t[1]![2] + t[2]![2]) / 3];
    const on = (q: V3) => bucket.some(s => inTriExact(q, s));
    if (!on(cen) || !t.every(on)) n++;
  }
  return n;
}

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
  test('DIRECTION option: DEFAULT = OUTWARD (the game’s own authored winding, v1.5.12); inward = the exact reversed twin', () => {
    const mkPair = () => bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ type: 1, pos_x: 6, pos_y: 5, pos_z: 5, colors: all(3) }),
    ]);
    const out = mkPair(), inn = mkPair();
    const ro = hullifyApply(out);                      // default = 'outward'
    const ri = hullifyApply(inn, { wind: 'inward' });
    expect(ri.trisAdded).toBe(ro.trisAdded);
    const ta = out.data.triangles!, tb = inn.data.triangles!;
    expect(tb.length).toBe(ta.length);
    // SAME geometric triangles (vertex multisets identical, lattice encoding
    // included) — the winding is the exact v1↔v2 reversal of each other:
    const key = (p: [number, number, number][]) =>
      p.map(q => q.map(x => x.toFixed(4)).join()).sort().join('|');
    const nrm = (p: V3[]): V3 => vcross(vsub(p[1]!, p[0]!), vsub(p[2]!, p[0]!));
    const normOut = new Map(ta.map(t => [key(triWorld(t)), nrm(triWorld(t))]));
    for (const t of tb) {
      const w = triWorld(t);
      const m = normOut.get(key(w));
      expect(m).toBeDefined();
      const n = nrm(w);
      const dot = n.reduce((s, v, i) => s + v * m![i]!, 0);
      const len = Math.hypot(...n) * Math.hypot(...m!);
      expect(dot / len).toBeLessThan(-0.999);          // exactly antiparallel
    }
    // the literal rule on a lone cube: its +x extreme face carries a +x
    // winding normal outward, and a −x one inward
    const lone = (wind?: 'inward' | 'outward') => {
      const bp = bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(0) })]);
      hullifyApply(bp, wind ? { wind } : {});
      const face = bp.data.triangles!.filter(t => triWorld(t).every(p => p[0] === 0))
        .map(t => nrm(triWorld(t)));
      expect(face.length).toBe(2);
      return face.every(n => Math.sign(n[0]!) === (wind === 'inward' ? -1 : 1));
    };
    expect(lone('inward')).toBe(true);
    expect(lone()).toBe(true);                         // default outward
  });

  test('SHADE option: DEFAULT = flat (no key — what the game’s own fresh triangles carry, v1.5.12); smooth writes smooth:1', () => {
    const mk = () => bpOf([block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) })]);
    const asRec = (t: unknown) => t as Record<string, unknown>;
    const fl = mk();
    hullifyApply(fl);                                  // default shade = flat
    const sm = mk();
    hullifyApply(sm, { shade: 'smooth' });
    const ta = fl.data.triangles!, tb = sm.data.triangles!;
    expect(ta.length).toBeGreaterThan(0);
    expect(tb.length).toBe(ta.length);
    expect(ta.every(t => !('smooth' in asRec(t)))).toBe(true);
    expect(tb.every(t => asRec(t)['smooth'] === 1)).toBe(true);
    // the flag is NOT geometry: every other field is IDENTICAL
    expect(tb.map(t => { const r = { ...asRec(t) }; delete r['smooth']; return r; }))
      .toEqual(ta.map(t => ({ ...asRec(t) })));
    // EXISTING triangles are kept verbatim — the tool never re-writes them
    const keep = mk();
    const authored = { ...asRec(ta[0]!) } as typeof ta[number];
    keep.data.triangles = [authored];
    hullifyApply(keep);
    expect(asRec(keep.data.triangles![0]!)).toEqual(authored);
    expect(keep.data.triangles!.length).toBeGreaterThan(1);
  });

  test('GAME-CONVENTION (v1.5.12): the defaults reproduce the game’s own triangle authoring (fixture 9000006001 vs hullify of 9000005001)', () => {
    const load = (id: string): Blueprint =>
      JSON.parse(readFileSync(
        new URL(`../../../../testdata/${id}/blueprint.json`, import.meta.url).pathname, 'utf8')) as Blueprint;
    const asRec = (t: unknown) => t as Record<string, unknown>;
    const nrm = (p: V3[]): V3 => vcross(vsub(p[1]!, p[0]!), vsub(p[2]!, p[0]!));

    // The user's in-game-TRI-AUTHORED craft (the game's own tool snapped
    // three triangles onto the corner block of testframe): no smooth key,
    // every winding normal points AWAY from the corner's solid centroid.
    const g = load('9000006001');
    const gtris = (g.data.triangles ?? []) as unknown as Triangle[];
    expect(gtris.length).toBe(3);
    expect(gtris.every(t => !('smooth' in asRec(t)))).toBe(true);
    const corner = g.data.blocks[1]!;                     // the type-13 corner
    const gc = blkCell(corner), gs = blkSpan(corner);
    const pts = getBlockPoints(corner.type,
      [cellM(gc[0]!), cellM(gc[1]!), cellM(gc[2]!)],
      [gs[0] * CELL, gs[1] * CELL, gs[2] * CELL]);
    const mid: V3 = [0, 1, 2].map(ax => pts.reduce((s, p) => s + p[ax]!, 0) / pts.length) as V3;
    for (const t of gtris) {
      const w = triWorld(t);
      expect(Math.max(...w.map(p => p[1]!))).toBeGreaterThan(Math.min(...w.map(p => p[1]!)) + 0.05);
      expect(nrm(w).reduce((s, v, i) => s + v * (w[0]![i]! - mid[i]!), 0))
        .toBeGreaterThan(0);                               // OUTWARD, as authored
    }

    // Hullify the SAME craft before the triangles existed (9000005001 =
    // testframe): the defaults match the game's conventions piece for piece.
    const bp = load('9000005001');
    hullifyApply(bp);
    const ours = bp.data.triangles!;
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.every(t => !('smooth' in asRec(t)))).toBe(true);   // flat by default
    const key = (p: V3[]) => p.map(q => q.map(x => x.toFixed(4)).join()).sort().join('|');
    const gameKeys = new Set(gtris.map(t => key(triWorld(t))));
    const ourCorner = ours.filter(t => {
      const w = triWorld(t);
      // sits on/above the deck top (y = −1.25) and is not a flat cap
      return Math.min(...w.map(p => p[1]!)) > -1.25 - 1e-6
        && Math.max(...w.map(p => p[1]!)) > Math.min(...w.map(p => p[1]!)) + 0.05;
    });
    expect(ourCorner.length).toBe(3);                      // bottom flush ▸ culled
    for (const t of ourCorner) {
      const w = triWorld(t);
      expect(nrm(w).reduce((s, v, i) => s + v * (w[0]![i]! - mid[i]!), 0))
        .toBeGreaterThan(0);                               // winds OUTWARD too
    }
    // vertex-for-vertex, our three corner triangles ARE the game's three
    // faces (the flush bottom culled both ways) — the ONLY differences were
    // the conventions: the game winds OUT and carries no smooth key, which
    // is exactly what the defaults now emit
    expect(ourCorner.filter(t => gameKeys.has(key(triWorld(t)))).length).toBe(3);
  });

  test('two glued cubes: the shared border emits NOTHING, every other face is its own quad pair', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3), material: 2 }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(3), material: 2 }),
    ]);
    const prev = hullifyPreview(bp);
    expect(prev.ok).toBe(true);
    expect(prev.blocksRemoved).toBe(2);
    // 12 cube faces − 2 on the precisely shared border = 10 face quads
    // = 20 triangles, each its BLOCK'S OWN corners (no cross-block merge)
    expect(prev.trisAdded).toBe(20);
    // preview never mutates
    expect(bp.data.blocks.length).toBe(2);
    expect(bp.data.triangles ?? []).toEqual([]);

    const res = hullifyApply(bp);
    expect(res.trisAdded).toBe(20);
    expect(bp.data.blocks.length).toBe(0);
    const tris = bp.data.triangles!;
    // the box 0.5 × 0.25 × 0.25 m: surface 0.625 m² — the SAME area cull shows
    const culled = culledBlocksSolids([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3), material: 2 }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(3), material: 2 }),
    ], null, false);
    expect(areaSum(tris.map(triWorld))).toBeCloseTo(
      areaSum(culled.tris.map(t => t.tri)), 9);
    // NO triangle lies on the shared border plane (cells 5|6 ▸ world x = 0)
    for (const t of tris) {
      const w = triWorld(t);
      expect(w.every(p => p[0] === 0)).toBe(false);
    }
    // every face keeps the block's colour + material on all five prism faces
    for (const t of tris) {
      expect(t.colors).toEqual([3, 3, 3, 3, 3]);
      expect(t.material).toBe(2);
    }
  });

  test('a 13-cube row: only the 24 shared-border faces die (108 tris), no merged prisms', () => {
    const blocks = Array.from({ length: 13 }, (_, i) =>
      block({ pos_x: 2 + i, pos_y: 5, pos_z: 5, colors: all(3) }));
    // crosses a frame boundary (cells 2..14) → the writer re-anchors frames
    blocks[12]!.pos_x = 2; blocks[12]!.frame_x = 1;
    const res = hullifyPreview(bpOf(blocks));
    // 78 cube faces − 12 border pairs × 2 = 54 face quads = 108 triangles
    expect(res.trisAdded).toBe(108);
    expect(res.skipped).toBe(0);
  });

  test('a lone wedge: the square faces are TWO triangles, the slanted side ONE', () => {
    const bp = bpOf([
      block({ type: 1, pos_x: 5, pos_y: 5, pos_z: 5, colors: [9, 3, 3, 3, 3, 3, 3] }),
    ]);
    const res = hullifyPreview(bp);
    // the SLOPE shape = slant(2) + right(1) + left(1) + front(2) + bottom(2)
    expect(res.trisAdded).toBe(8);
    hullifyApply(bp);
    const culled = culledBlocksSolids(
      [block({ type: 1, pos_x: 5, pos_y: 5, pos_z: 5, colors: [9, 3, 3, 3, 3, 3, 3] })], null, false);
    expect(areaSum(bp.data.triangles!.map(triWorld))).toBeCloseTo(
      areaSum(culled.tris.map(t => t.tri)), 9);
    // per axis-plane triangle counts: the wedge's two profile sides are
    // planes of exactly ONE triangle each (the user's rule), its square
    // sides are planes of TWO (the face's own diagonal split)
    const planeCounts = new Map<string, number>();
    for (const t of bp.data.triangles!) {
      const w = triWorld(t);
      for (const ax of [0, 1, 2] as const)
        if (w.every(p => p[ax] === w[0]![ax]!))
          planeCounts.set(`${ax}|${w[0]![ax]!}`, (planeCounts.get(`${ax}|${w[0]![ax]!}`) ?? 0) + 1);
    }
    const xs = [...planeCounts.entries()].filter(([k]) => k.startsWith('0|')).map(([, v]) => v).sort();
    expect(xs, 'wedge profile sides: one triangle each').toEqual([1, 1]);
    expect([...planeCounts.values()], 'square sides: two triangles').toContain(2);
  });

  test('two wedges glued slant-to-slant share that border PRECISELY: it emits NO triangle', () => {
    // type 1 + type 3 (rot index 2 = the half-turn) fill one full cell
    const bp = bpOf([
      block({ type: 1, pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ type: 3, pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
    ]);
    const res = hullifyPreview(bp);
    // the pair behaves like ONE CUBE: 6 face quads = 12 triangles, the
    // interior slant partition (identical footprints) dropped both copies
    expect(res.trisAdded).toBe(12);
    hullifyApply(bp);
    const culled = culledBlocksSolids([
      block({ type: 1, pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ type: 3, pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
    ], null, false);
    expect(areaSum(bp.data.triangles!.map(triWorld))).toBeCloseTo(
      areaSum(culled.tris.map(t => t.tri)), 9);
  });

  test('different colours: no merge, every face stays its own block quad pair', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3) }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(48) }),
    ]);
    const res = hullifyPreview(bp);
    // same as the single-colour pair: the seam faces are culled either way
    expect(res.trisAdded).toBe(20);
    hullifyApply(bp);
    // every triangle spans exactly 1 cell (per-block faces, never merged)
    for (const t of bp.data.triangles!) {
      const w = triWorld(t);
      for (const a of [0, 1, 2] as const)
        expect(Math.max(...w.map(p => p[a]!)) - Math.min(...w.map(p => p[a]!))).toBeLessThanOrEqual(CELL + 1e-9);
    }
    // both colours survived, five prism faces each
    expect(new Set(bp.data.triangles!.flatMap(t => t.colors ?? [])).size).toBe(2);
  });

  test('different MATERIALS: each face keeps its block material', () => {
    const bp = bpOf([
      block({ pos_x: 5, pos_y: 5, pos_z: 5, colors: all(3), material: 0 }),
      block({ pos_x: 6, pos_y: 5, pos_z: 5, colors: all(3), material: 5 }),
    ]);
    const res = hullifyPreview(bp);
    expect(res.trisAdded).toBe(20);
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

  test('CORPUS SMOKE: every block craft converts; area EXACTLY = the culled surface AND zero stray triangles', () => {
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
      // CONTAINMENT (the ISW-241 wing lesson): equal area alone is NOT the
      // shape — every triangle's centroid and corners must lie ON the exact
      // culled surface. Area + containment together pin the union.
      expect(straysOf(probe.data.triangles!.map(triWorld), culled.tris.map(t => t.tri)), d)
        .toBe(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  }, 120_000);        // 25-craft convert+cull+containment census — slow on the iGPU box
});
