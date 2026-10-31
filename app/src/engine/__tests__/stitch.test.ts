// hull.ts v1.12.7 DRAW-ONLY SKIN STITCH pins (the hullify FPS-drain fix).
// The laws proved here:
//  • a qualifying pair (unit-cell square pair / N×M quad pair, same plane,
//    same orientation, one colour in all five slots) merges into ONE 12-face
//    rectangle prism;
//  • complete cells tile into maximal rectangles — NO interior-seam wall
//    survives (the merged slab has walls only on its boundary);
//  • cap coverage is EXACT: per oriented plane, the merged cap area equals
//    the sum of the raw records' cap areas (area equality alone is not
//    enough — the coplanar caps of one group share NO interior overlap: the
//    rectangle tiling partitions the cell set);
//  • every merged face is OUTWARD (convex-slab test: normal·(centroid −
//    slab centre) > 0);
//  • everything ineligible (per-face paint, slant normals, lone
//    half-squares, big authored triangles) keeps its VERBATIM prism —
//    byte-equal faces to buildHullSkin;
//  • authored corpus skins (ISW chrome/hull/glass, the game's corner
//    triangles, the gantry sheet) render IDENTICALLY to the old path;
//  • wire + record count are unchanged (file verbatim, overlays as before).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { HULL_T, buildHullSkin, stitchHullSkin, type HullFace } from '../hull';
import { hullifyApply } from '../tools';
import type { Blueprint, Triangle } from '../format';
import { CELL } from '../format';
import { corpusDir } from '../../../tools/vite-corpus.ts';

/** record from integer lattice g corners (v=g for g<12 keeps frames 0). */
const tri = (g: [number, number][], slot: number | number[]): Triangle => {
  const v = g.map(([gu, gv]) => ({ u: gu, v: gv }));
  const o: Record<string, number | number[]> = {
    v0_x: v[0]!.u, v0_z: v[0]!.v, v1_x: v[1]!.u, v1_z: v[1]!.v, v2_x: v[2]!.u, v2_z: v[2]!.v,
    frame_x: 0, frame_z: 0,
  };
  if (Array.isArray(slot)) o.colors = slot; else o.colors = [slot, slot, slot, slot, slot];
  return o as unknown as Triangle;
};
/** y = plane offset: pin the plane by placing ALL g on that plane, axis y. */
const triY = (off: number, g: [number, number][], slot: number | number[]): Triangle => {
  const o = tri(g, slot) as unknown as Record<string, number | number[]>;
  o['v0_y'] = off; o['v1_y'] = off; o['v2_y'] = off; o['frame_y'] = 0;
  return o as unknown as Triangle;
};
/** one unit cell of a +y skin at plane `off` = the cellQuad pair (tools law) */
const cellPair = (cu: number, cv: number, off: number, slot: number | number[]): Triangle[] => {
  const ccw: [number, number][] = [[cu, cv], [cu + 1, cv], [cu + 1, cv + 1], [cu, cv + 1]];
  return [triY(off, [ccw[0]!, ccw[1]!, ccw[2]!], slot), triY(off, [ccw[2]!, ccw[3]!, ccw[0]!], slot)];
};

const area = (f: HullFace): number => {
  const [a, b, c] = f.tri;
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const wx = c[0]! - a[0]!, wy = c[1]! - a[1]!, wz = c[2]! - a[2]!;
  const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
  return Math.hypot(cx, cy, cz) / 2;
};
const normal = (f: HullFace): [number, number, number] => {
  const [a, b, c] = f.tri;
  const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
  const wx = c[0]! - a[0]!, wy = c[1]! - a[1]!, wz = c[2]! - a[2]!;
  const n: [number, number, number] = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0]! / l, n[1]! / l, n[2]! / l];
};
const centroid = (f: HullFace): [number, number, number] => [
  (f.tri[0]![0]! + f.tri[1]![0]! + f.tri[2]![0]!) / 3,
  (f.tri[0]![1]! + f.tri[1]![1]! + f.tri[2]![1]!) / 3,
  (f.tri[0]![2]! + f.tri[1]![2]! + f.tri[2]![2]!) / 3,
];

describe('stitchHullSkin — the stitch law', () => {
  test('a unit-cell pair merges to ONE 12-face rectangle prism', () => {
    const raw = buildHullSkin(cellPair(8, 8, 10, 3));
    const st = stitchHullSkin(cellPair(8, 8, 10, 3));
    expect(raw.faces).toHaveLength(16);           // two 8-face prisms
    expect(st.faces).toHaveLength(12);            // 2 cap quads + 4 wall quads
    // the diagonal interior seam is GONE: no in-plane wall on the diagonal
    const mid = (10 - 6) * CELL;
    for (const f of st.faces) {
      const n = normal(f);
      if (Math.abs(n[1]) > 0.9) continue;         // caps
      const c = centroid(f);
      const d = Math.hypot(c[0] - (8 - 6) * CELL, c[2] - (8 - 6) * CELL);
      void d;
      // every wall sits on a CELL BOUNDARY (perimeter), never on the diagonal
      const onEdge
        = Math.abs(c[0] - (8 - 6) * CELL) < 1e-9 || Math.abs(c[0] - (9 - 6) * CELL) < 1e-9
        || Math.abs(c[2] - (8 - 6) * CELL) < 1e-9 || Math.abs(c[2] - (9 - 6) * CELL) < 1e-9;
      expect(onEdge).toBe(true);
    }
    // caps cover exactly the cell
    const caps = st.faces.filter(f => Math.abs(normal(f)[1]) > 0.9);
    expect(caps).toHaveLength(4);
    const capArea = caps.reduce((s, f) => s + area(f), 0);
    expect(capArea).toBeCloseTo(CELL * CELL * 2, 12);   // front+back = 2 cells
    // +y caps at +T, −y caps at −T
    for (const f of caps) {
      const y = centroid(f)[1];
      expect(Math.abs(Math.abs(y - mid) - HULL_T)).toBeLessThan(1e-9);
    }
    // counts + wire verbatim
    expect(st.tris).toBe(raw.tris);
    expect(st.wire).toEqual(raw.wire);
  });

  test('3×2 cells tile to ONE rectangle: no interior walls, exact caps', () => {
    const tris: Triangle[] = [];
    for (let u = 8; u < 11; u++) for (let v = 8; v < 10; v++) tris.push(...cellPair(u, v, 12, 5));
    expect(tris).toHaveLength(12);
    const raw = buildHullSkin(tris);
    const st = stitchHullSkin(tris);
    expect(raw.faces).toHaveLength(96);
    expect(st.faces).toHaveLength(12);            // 1 rectangle: caps + 4 walls
    const caps = st.faces.filter(f => Math.abs(normal(f)[1]) > 0.9);
    expect(caps.reduce((s, f) => s + area(f), 0)).toBeCloseTo(6 * CELL * CELL * 2, 12);
    const walls = st.faces.filter(f => Math.abs(normal(f)[1]) < 0.1);
    expect(walls.reduce((s, f) => s + area(f), 0)).toBeCloseTo(2 * (3 + 2) * CELL * HULL_T * 2, 12);
    // perimeter walls only: no wall interior to the patch
    for (const f of walls) {
      const c = centroid(f);
      const inU = (c[0] - (8 - 6) * CELL) / CELL, inV = (c[2] - (8 - 6) * CELL) / CELL;
      const onBorder = [inU, inV].some(x => Math.abs(x % 1) < 1e-9 && x >= 0) &&
        (Math.abs(inU) < 1e-9 || Math.abs(inU - 3) < 1e-9 || Math.abs(inV) < 1e-9 || Math.abs(inV - 2) < 1e-9);
      expect(onBorder).toBe(true);
    }
  });

  test('L-shape tiles into 2 rectangles (greedy maximal cover)', () => {
    const tris = [...cellPair(8, 8, 4, 1), ...cellPair(9, 8, 4, 1), ...cellPair(10, 8, 4, 1), ...cellPair(8, 9, 4, 1)];
    const st = stitchHullSkin(tris);
    expect(st.faces).toHaveLength(24);            // two merged prisms
    const caps = st.faces.filter(f => Math.abs(normal(f)[1]) > 0.9);
    expect(caps.reduce((s, f) => s + area(f), 0)).toBeCloseTo(4 * CELL * CELL * 2, 12);
  });

  test('per-face paint (colours differ) stays the VERBATIM prism', () => {
    const painted = cellPair(8, 8, 10, [3, 3, 4, 4, 4]);
    const st = stitchHullSkin(painted);
    expect(st.faces).toEqual(buildHullSkin(painted).faces);
  });

  test('slant normals (two nonzero cross components) stay the VERBATIM prism', () => {
    const slant = [tri([[6, 6], [7, 6], [7, 7]], 2), tri([[7, 7], [6, 7], [6, 6]], 2)];
    // the cell lives in the (x,z)-plane at y=off → force a diagonal plane:
    const s = slant.map(t => {
      const o = t as unknown as Record<string, number>;
      o['v0_y'] = 0; o['v1_y'] = 1; o['v2_y'] = 2; o['frame_y'] = 0;
      return t;
    });
    const st = stitchHullSkin(s);
    expect(st.faces).toEqual(buildHullSkin(s).faces);
  });

  test('lone half-square (corner-block face) stays the VERBATIM prism', () => {
    const lone = [triY(10, [[8, 8], [9, 8], [8, 9]], 7)];
    const st = stitchHullSkin(lone);
    expect(st.faces).toEqual(buildHullSkin(lone).faces);
  });

  test('an N×M quad pair (isolated face, emitPoly law) merges to one prism', () => {
    const quad: [number, number][] = [[4, 4], [16, 4], [16, 16], [4, 16]];
    const pair = [triY(0, [quad[0]!, quad[1]!, quad[2]!], 6), triY(0, [quad[2]!, quad[3]!, quad[0]!], 6)];
    expect(buildHullSkin(pair).faces).toHaveLength(16);
    const st = stitchHullSkin(pair);
    expect(st.faces).toHaveLength(12);
    const caps = st.faces.filter(f => Math.abs(normal(f)[1]) > 0.9);
    expect(caps.reduce((s, f) => s + area(f), 0)).toBeCloseTo((12 * CELL) ** 2 * 2, 10);
  });

  test('every merged face winds OUTWARD (convex-slab test)', () => {
    const tris: Triangle[] = [];
    for (let u = 5; u < 9; u++) for (let v = 7; v < 9; v++) tris.push(...cellPair(u, v, 3, 9));
    const st = stitchHullSkin(tris);
    for (const f of st.faces) {
      // slab centre of the face's rectangle: centroid projected on the plane
      const c = centroid(f);
      const n = normal(f);
      // outward = normal·(faceCentroid − slabMid) > 0 with slabMid = slab centre
      const mid: [number, number, number] = [0, 0, 0];
      for (const f2 of st.faces) {
        const c2 = centroid(f2);
        for (let a = 0; a < 3; a++) mid[a]! += c2[a]! / st.faces.length;
      }
      const d = (c[0]! - mid[0]!) * n[0]! + (c[1]! - mid[1]!) * n[1]! + (c[2]! - mid[2]!) * n[2]!;
      expect(d).toBeGreaterThan(1e-9);
    }
  });

  test('stitching is deterministic (same faces, same order, twice)', () => {
    const tris = [...cellPair(2, 2, 5, 1), ...cellPair(3, 2, 5, 1), ...cellPair(2, 3, 5, 1), triY(5, [[6, 6], [7, 6], [6, 7]], 1)];
    expect(stitchHullSkin(tris).faces).toEqual(stitchHullSkin(tris).faces);
  });

  test('opposite orientation never merges (sign is in the group key)', () => {
    const up = cellPair(8, 8, 10, 3);
    const down = JSON.parse(JSON.stringify(up)).map((t: Record<string, number>) => {
      const a = [t['v0_x'], t['v0_z']], b = [t['v1_x'], t['v1_z']];
      t['v0_x'] = b[0]!; t['v0_z'] = b[1]!; t['v1_x'] = a[0]!; t['v1_z'] = a[1]!;
      return t;
    }) as Triangle[];
    const st = stitchHullSkin([...up, ...down]);
    // the two groups each merge separately (12 + 12), never one 12-face slab
    expect(st.faces).toHaveLength(24);
  });
});

describe('stitchHullSkin — corpus invariants', () => {
  const ids = existsSync(corpusDir())
    ? readdirSync(corpusDir()).filter(d => existsSync(`${corpusDir()}/${d}/blueprint.json`))
    : [];
  const load = (id: string): Blueprint =>
    JSON.parse(readFileSync(`${corpusDir()}/${id}/blueprint.json`, 'utf8')) as Blueprint;

  test('small authored skins render IDENTICALLY to the verbatim path', () => {
    // ISW chrome/hull/glass (slots 0/4/51), the game's corner triangles
    // (9000006001), the postest fixtures' authored skins: hand-authored sets
    // never match the stitch law (per-face paint, slants, lone halves), so
    // faces must be byte-equal. Big welded skins (gantry 241, Badger 1337)
    // MAY hold legal rectangle pairs — they answer to the COVERAGE pin.
    //
    // COVERAGE_AUTHORED (v1.16.12): an AUTHORED small skin that legitimately
    // contains a rectangle-legal pair — Chip Patton's ChipOS Dev Kit ships a
    // one-colour straight sheet whose halves are a clean weld target. The
    // stitch is DRAW-ONLY (file verbatim) and its merged slabs are
    // coverage-exact by the LAW tests, so the premise "authored ⇒ byte-
    // equal" is empirically false for such a skin: it answers to the SAME
    // coverage law as the big skins — per-plane cap areas equal, face count
    // strictly lower. (The dev kit's game-side save, ingested 2026-10-30,
    // is the machine corpus where this fired.)
    const COVERAGE_AUTHORED = new Set(['3828773626']);
    const capsByPlane = (fs: HullFace[]): string[] => {
      const m = new Map<string, number>();
      for (const f of fs) {
        const n = normal(f), c = centroid(f);
        const ax = n[0]! > 0.999 ? 0 : n[1]! > 0.999 ? 1 : n[2]! > 0.999 ? 2 : -1;
        if (ax < 0) continue;
        const co = (c as number[])[ax]!;
        const g = co / CELL + 6;
        if (Math.abs(g - Math.round(g)) < 1e-6) continue;        // on-lattice = wall
        m.set(`${ax}+${co.toFixed(4)}`, (m.get(`${ax}+${co.toFixed(4)}`) ?? 0) + area(f));
      }
      return [...m.entries()].map(([k, v]) => `${k}=${v.toFixed(6)}`).sort();
    };
    let checked = 0;
    for (const id of ids) {
      const tris = load(id).data.triangles ?? [];
      if (tris.length < 3 || tris.length > 100) continue;
      const st = stitchHullSkin(tris);
      const raw = buildHullSkin(tris);
      if (COVERAGE_AUTHORED.has(id)) {
        expect(capsByPlane(st.faces), id).toEqual(capsByPlane(raw.faces));
        expect(st.faces.length, id).toBeLessThan(raw.faces.length);
        checked++;
        continue;
      }
      const key = (fs: HullFace[]) => fs.map(f => `${f.slot}:${f.tri.map(v => v.map(x => x.toFixed(6)).join()).join(';')}`).sort();
      expect(key(st.faces), id).toEqual(key(raw.faces));
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });

  test('a hullified craft shrinks on every face and HARD in sum', () => {
    let rawSum = 0, stSum = 0, crafts = 0, best = 1;
    for (const id of ids) {
      const bp = load(id);
      if ((bp.data.blocks ?? []).filter(b => b.type !== 255).length < 50) continue;
      const r = hullifyApply(load(id));
      if (!r.ok) continue;
      const raw = buildHullSkin(r.tris!);
      const st = stitchHullSkin(r.tris!);
      expect(st.faces.length, id).toBeLessThanOrEqual(raw.faces.length);
      // cap coverage per oriented plane: sum of signed cap areas by
      // (axis, plane±T). CAPS = faces whose normal is EXACTLY the plane
      // axis (|n|>0.999) — their centroid sits at plane±HULL_T, OFF the
      // lateral lattice. Walls (axis seams AND the diagonal/hypotenuse
      // interior seams of raw pairs, normal 0.949 on a shallow 1:3 slope)
      // are what the stitch REMOVES — the perimeter/containment of the
      // wall set is pinned by the LAW tests, not this coverage sweep.
      const caps = (fs: HullFace[]) => {
        const m = new Map<string, number>();
        for (const f of fs) {
          const n = normal(f), c = centroid(f);
          const ax = n[0]! > 0.999 ? 0 : n[1]! > 0.999 ? 1 : n[2]! > 0.999 ? 2 : -1;
          if (ax < 0) continue;
          const co = (c as number[])[ax]!;
          const g = co / CELL + 6;
          if (Math.abs(g - Math.round(g)) < 1e-6) continue;        // on-lattice = wall
          m.set(`${ax}+${co.toFixed(4)}`, (m.get(`${ax}+${co.toFixed(4)}`) ?? 0) + area(f));
        }
        return m;
      };
      const a = caps(raw.faces), b = caps(st.faces);
      expect([...b.keys()].sort(), id).toEqual([...a.keys()].sort());
      for (const k of a.keys()) expect(b.get(k)!, `${id} ${k}`).toBeCloseTo(a.get(k)!, 9);
      const ratio = st.faces.length / raw.faces.length;
      // a 1-cell face pair is 16 → 12 faces (0.75) — the floor for tiny
      // faces; large welded faces shrink to the cap+rim share.
      expect(ratio, id).toBeLessThanOrEqual(0.85);
      rawSum += raw.faces.length; stSum += st.faces.length; crafts++;
      if (ratio < best) best = ratio;
    }
    expect(crafts).toBeGreaterThanOrEqual(3);
    expect(best).toBeLessThanOrEqual(0.25);          // the giant case: 4.6×
    expect(stSum / rawSum).toBeLessThanOrEqual(0.4); // the corpus total: ~3.4×
  });
});
