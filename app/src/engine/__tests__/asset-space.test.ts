// asset-space.test.ts — the engine content basis (2026-10-19, XenonViewer-
// authoritative; FORMAT §Per-asset gltf VERTEX SPACE).
//
// XenonViewer (user-confirmed = the game) places EVERY component as
//     content = C · chain(.ini eulers) · C⁻¹ · v_gltf ,  C(file→content) = (x, z, −y)
// Our renderer realises the identical map as
//     basisGroup C  ▸  RAW .ini chain  ▸  unityBake(C⁻¹)-baked atlas verts
// (scene.ts buildReal + models.ts bakeGeo). The solo-pair routine
// (app/tools/solopair.mjs over tools/make_solo_test.py fixtures) verifies it
// against the live dev viewer per type; these pins lock the algebra so a
// refactor can't silently drop a C.
import { describe, expect, it } from 'vitest';
import { unityBake } from '../models';

type M3 = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
const C: M3 = [[1, 0, 0], [0, 0, 1], [0, -1, 0]];      // (x,z,−y)
const mv = (A: M3, v: readonly number[]): number[] =>
  ([0, 1, 2] as const).map(r => A[r][0] * v[0]! + A[r][1] * v[1]! + A[r][2] * v[2]!);

describe('content basis C and the loader bake C⁻¹', () => {
  it('C is a proper rotation (det +1)', () => {
    const [a, b, c] = C;
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
      + a[2] * (b[0] * c[1] - b[1] * c[0]);
    expect(det).toBeCloseTo(1, 9);
  });
  it('unityBake == C⁻¹ on a general vector', () => {
    const v = [0.3, -0.7, 0.5];
    expect(unityBake(v)).toEqual(mv([[1, 0, 0], [0, 0, -1], [0, 1, 0]], v));
  });
  it('bake∘C = identity (wrap + bake cancel the glTF author rotation)', () => {
    const v = [0.3, -0.7, 0.5];
    expect(unityBake(mv(C, v))).toEqual(v.map(x => +x.toFixed(12)));
    expect(mv(C, unityBake(v))).toEqual(v.map(x => +x.toFixed(12)));
  });
  it('C maps the engine UP (file ŷ) to the content +ŷ of the dev frame… via ẑ', () => {
    // C(ŷ) = (0,0,1): a node offset written as (0, +y, 0) in the .ini lands
    // at content +ẑ — exactly the dev catalog (ActiveRadiator axle
    // (0,−0.12,0) → catalog (0,0,0.12), verified against its catalog.json).
    expect(mv(C, [0, -0.12, 0])).toEqual([0, 0, 0.12]);
  });
  it('unityBake preserves lengths and handedness (rotation, not mirror)', () => {
    const a = unityBake([1, 2, 3]), b = unityBake([4, -5, 6]);
    const dot0 = 1 * 4 + 2 * -5 + 3 * 6, dot1 = a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot1).toBeCloseTo(dot0, 12);
  });
});
