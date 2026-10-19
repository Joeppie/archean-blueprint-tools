// asset-space.test.ts — per-asset glTF VERTEX SPACE (AGENTS §Known open issues,
// the v0.143/v0.145 revert lesson: never touch per-asset alignment without a
// MEASURED, sign-sensitive pin). The game bakes Blender/Z-up assets into the
// Unity part frame as (gx,-gz,gy); the collider box (.ini, part FILE frame)
// is the arbiter. These pins lock unityBake + the table gate so a silent flip
// of an axisymmetric or y-up asset fails loudly.
import { describe, expect, it } from 'vitest';
import { UNITY_BAKED_TYPES, unityBake } from '../models';

const extent = (v: number[]) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < v.length; k += 3)
    for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a]!, v[k + a]!); mx[a] = Math.max(mx[a]!, v[k + a]!); }
  return { mn: mn as number[], mx: mx as number[], span: mx.map((h, a) => h - mn[a]!) };
};

describe('unityBake (x, -z, y)', () => {
  it('maps the three basis axes exactly like the game import', () => {
    // x̂ ŷ ẑ stacked as three vertices
    const b = unityBake([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const near = (got: number[], want: number[]) =>
      expect(got.map((v, i) => [v, want[i]] as const).every(([g, w]) => Math.abs(g - w!) < 1e-12)).toBe(true);
    near(b.slice(0, 3), [1, 0, 0]);      // x̂ → x̂
    near(b.slice(3, 6), [0, 0, 1]);      // ŷ → +ẑ
    near(b.slice(6, 9), [0, -1, 0]);     // ẑ → −ŷ
  });
  it('is a rotation (det +1, unit volume preserved)', () => {
    // the 3×3 rows are the images of x̂ ŷ ẑ: (1,0,0)(0,0,-1)(0,1,0) → det = +1
    const b = unityBake([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const m = [[b[0], b[3], b[6]], [b[1], b[4], b[7]], [b[2], b[5], b[8]]];
    const det = m[0][0]! * (m[1][1]! * m[2][2]! - m[1][2]! * m[2][1]!)
      - m[0][1]! * (m[1][0]! * m[2][2]! - m[1][2]! * m[2][0]!)
      + m[0][2]! * (m[1][0]! * m[2][1]! - m[1][1]! * m[2][0]!);
    expect(det).toBeCloseTo(1, 9);
  });
  it('swaps the Y and Z extents (the space a thin-Y collider arbitrates)', () => {
    // a flat slab thin in Y (0.1) but long in Z (1.0): bake makes it thin in
    // Z long in Y — the ActiveRadiator base / PassiveRadiator pattern.
    const slab = [0, 0, 0, 1, 0, 0, 0, 0.1, 0, 0, 0, 1];
    const raw = extent(slab);
    expect(raw.span[1]).toBeCloseTo(0.1, 6);
    expect(raw.span[2]).toBeCloseTo(1.0, 6);
    const bak = extent(unityBake(slab));
    expect(bak.span[1]).toBeCloseTo(1.0, 6);
    expect(bak.span[2]).toBeCloseTo(0.1, 6);
  });
  it('is the C⁻¹ that undoes XenonViewer C=(x,z,-y) up to sign of the swap', () => {
    const C = (v: number[]) => [v[0], v[2], -v[1]];   // Unity/file → glTF/dev
    const orig = [0.3, -0.7, 0.5];
    const round = unityBake(C(orig) as number[]);
    expect(round).toEqual(orig);
  });
});

describe('UNITY_BAKED_TYPES table (majority only)', () => {
  // types the collider census classifies strictly-better baked
  for (const T of ['ActiveRadiator', 'Aileron', 'PassiveRadiator', 'Crafter',
    'PilotSeat', 'TrashCan', 'SmallTurboPump', 'SolarPanel', 'ChemicalReactor'])
    it(`bakes ${T}`, () => expect(UNITY_BAKED_TYPES.has(T)).toBe(true));

  // ties / y-up / degenerate-collider parts STAY RAW (default = the pre-fix
  // look): wheels, the Beacon mast, junctions, ToggleButton — v0.145's global
  // bake was reverted exactly because these flip upside-down.
  for (const T of ['Wheel', 'BigWheel', 'SmallWheel', 'Beacon', 'FluidJunction',
    'ToggleButton', 'ToiletSeat', 'Propeller', 'DataBridge'])
    it(`leaves ${T} raw`, () => expect(UNITY_BAKED_TYPES.has(T)).toBe(false));
});
