// Corpus round-trip + grid maths pins (the byte-identical serialize rule from
// AGENTS.md "Format facts" and the world mapping invariants).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { corpusDir } from '../../../tools/vite-corpus.ts';
import { emitDoc, parseDoc } from '../doc';
import {
  CELL, FRAME, cellCoord, parseBlueprint, toViewQuat, worldCoord, type Blueprint,
} from '../format';
import { fitHull, hullVertex } from '../hullfit';

const CORPUS = corpusDir();
const haveCorpus = existsSync(CORPUS);
const craftIds = haveCorpus
  ? readdirSync(CORPUS).filter(d => /^\d{6,}$/.test(d) && existsSync(path.join(CORPUS, d, 'blueprint.json')))
  : [];

function load(id: string): { text: string; bp: Blueprint } {
  const text = readFileSync(path.join(CORPUS, id, 'blueprint.json'), 'utf8');
  return { text, bp: parseBlueprint(text) };
}

describe('grid maths', () => {
  test('world = (pos − 5.5)·0.25 + frame·3.0', () => {
    expect(worldCoord({ pos_x: 5, pos_y: 0, pos_z: 0, frame_x: 0 }, 'x')).toBeCloseTo(-0.125, 10);
    expect(worldCoord({ pos_x: 11, pos_y: 0, pos_z: 0, frame_x: 0 }, 'x')).toBeCloseTo(1.375, 10);
    expect(worldCoord({ pos_x: 0, pos_y: 0, pos_z: 0, frame_z: 2 }, 'z')).toBeCloseTo(-1.375 + 2 * FRAME, 10);
    expect(CELL).toBe(0.25);
  });
  test('cellCoord snaps world to the 0.25 m lattice (JS half-up rounding)', () => {
    // world(4) = −1.375·… → −1.5 cells → −1; world(6) → +0.5 cells → 1
    expect(cellCoord({ pos_x: 4, pos_y: 0, pos_z: 0, frame_x: 0 }, 'x')).toBe(-1);
    expect(cellCoord({ pos_x: 6, pos_y: 0, pos_z: 0, frame_x: 0 }, 'x')).toBe(1);
    expect(cellCoord({ pos_x: 5, pos_y: 0, pos_z: 0, frame_x: 1 }, 'x')).toBe(12);  // 2.875 m → 11.5 → 12
  });
  test('ONE raw quaternion law for BOTH generations (v1.5.11)', () => {
    const q = { w: 0.5, x: 0.5, y: 0.5, z: 0.5 };
    // v1.5.11 RE-ARBITRATION: the file quaternion IS the placement quaternion
    // for palette AND palette-less files alike (raw AS-IS — the display frame
    // IS the file frame since the v0.180 de-mirror, so the law is the
    // identity). Proof set: the game-built pyramid craft (IAS-418 testframe)
    // puts its dashboards flush on the slant faces ONLY under R(q) (dot
    // 0.999/1.000; conjugate = the boards skew through the deck = the editor
    // misfire the user screenshotted); the game-written L/R dashboard fixture
    // 9000004001 meets corner-to-corner flush under raw; the two ISW-241
    // saves (2025 workshop + 2026 re-save) keep BYTE-IDENTICAL orientations —
    // no conversion ever happens across generations. The old conjugate law
    // was a pre-v0.180 mirrored-chain artifact. See FORMAT §Handedness.
    expect(toViewQuat(q)).toEqual({ w: 0.5, x: 0.5, y: 0.5, z: 0.5 });
    expect(toViewQuat(toViewQuat(q))).toEqual(q);
  });
});

describe.skipIf(!haveCorpus || craftIds.length === 0)('corpus regression', () => {
  test(`every craft re-emits byte-identically (raw-literal doc, ${craftIds.length} files)`, () => {
    for (const id of craftIds) {
      const { text, bp } = load(id);
      // int-modelled fields stay bare ("type":0), double-modelled keep float
      // style ("y":1.0, 1e-08) — the doc keeps each literal's source text
      const out = emitDoc(parseDoc(text));
      if (out !== text) {
        let i = 0; while (i < text.length && out[i] === text[i]) i++;
        expect.fail(`${id}: differs @${i}\n  file: ${JSON.stringify(text.slice(i - 30, i + 30))}\n  ours: ${JSON.stringify(out.slice(i - 30, i + 30))}`);
      }
      expect(bp.data.blocks.length + bp.data.components.length, id).toBeGreaterThan(0);
    }
  });

  test('blocks sit within the bbox (mirror of regtest invariant 1)', () => {
    for (const id of craftIds) {
      const { bp } = load(id);
      for (const b of bp.data.blocks) {
        if (b.type === 255) continue;
        for (const ax of ['x', 'y', 'z'] as const) {
          const lo = worldCoord(b, ax) - CELL / 2;
          const hi = worldCoord(b, ax) + b[`size_${ax}`] * CELL + CELL / 2;
          expect(lo, `${id} ${ax}`).toBeGreaterThanOrEqual(bp.box_min[ax] - 0.35);
          expect(hi, `${id} ${ax}`).toBeLessThanOrEqual(bp.box_max[ax] + 0.35);
        }
      }
    }
  });

  test('hull lattice (exact W=12, pitch=0.25, C=−1.5) keeps skin in the bbox', () => {
    let withTriangles = 0;
    for (const id of craftIds) {
      const { bp } = load(id);
      const fit = fitHull(bp);
      if (!fit) continue;
      withTriangles++;
      expect(fit.W).toBe(12);
      expect(fit.px).toBe(0.25);
      expect(fit.Cx).toBe(-1.5);
      for (const t of bp.data.triangles!) for (const i of [0, 1, 2] as const) {
        const p = hullVertex(t, i);
        expect(p.x, `${id} vx`).toBeGreaterThanOrEqual(bp.box_min.x - 0.03);
        expect(p.x, `${id} vx`).toBeLessThanOrEqual(bp.box_max.x + 0.03);
        expect(p.z, `${id} vz`).toBeGreaterThanOrEqual(bp.box_min.z - 0.03);
        expect(p.z, `${id} vz`).toBeLessThanOrEqual(bp.box_max.z + 0.03);
      }
    }
    if (craftIds.length > 3) expect(withTriangles).toBeGreaterThan(0);
  });
});
