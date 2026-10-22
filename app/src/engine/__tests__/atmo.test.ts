// atmo.test.ts — the real-world buoyancy core (user 2026-10-22: "Archean
// uses real world data for this"). Pins:
//  • the ISA table against its published values (SL + one point per layer),
//  • the sea-level gas lifts every ballooner quotes (vacuum 1.225, He ~1.06,
//    H₂ ~1.14 kg per m³),
//  • the equilibrium solver (bisection re-scored through liftKg, sinks and
//    ceiling branches, vacuum-aboves-helium ordering),
//  • envelopeVolume: the divergence sum over CLOSED hull skins on the exact
//    FORMAT lattice (tetra + cube of triangleFromCorners records), and its
//    agreement with latsphere's own stats.volumeM3 for a generated skin.
import { describe, expect, test } from 'vitest';
import {
  ALT_CEILING, GASES, envelopeVolume, equilibrium, gasRho, isaAt, liftKg, maxFloatMassKg,
} from '../atmo';
import { triangleFromCorners, type Corner } from '../tris';
import { encodeSkinTri, spherePlan } from '../latsphere';
import type { Triangle } from '../format';

const near = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

describe('ISA standard atmosphere (U.S. Standard Atmosphere 1976)', () => {
  test('published sea-level values', () => {
    const s = isaAt(0);
    near(s.tK, 288.15, 1e-9);
    near(s.pPa, 101325, 1e-6);
    near(s.rhoKg, 1.225, 2e-4);
  });
  test('one probe per layer (11/20/32/47/51 km)', () => {
    near(isaAt(11000).pPa, 22632.1, 5);
    near(isaAt(11000).tK, 216.65, 1e-6);
    near(isaAt(11000).rhoKg, 0.36392, 5e-4);
    near(isaAt(20000).pPa, 5474.89, 5);
    near(isaAt(20000).rhoKg, 0.08803, 3e-4);
    near(isaAt(32000).tK, 228.65, 1e-6);
    near(isaAt(32000).rhoKg, 0.013224, 1e-5);
    near(isaAt(47000).pPa, 110.909, 0.5);
    near(isaAt(51000).rhoKg, 0.0008618, 1e-6);
  });
  test('density falls monotonically with altitude over the whole table', () => {
    let prev = Infinity;
    for (let h = 0; h <= ALT_CEILING; h += 517) {   // odd step: crosses seams
      const r = isaAt(h).rhoKg;
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });
  test('altitudes clamp to [0, ceiling]', () => {
    expect(isaAt(-9000).pPa).toBe(isaAt(0).pPa);
    expect(isaAt(1e9).pPa).toBe(isaAt(ALT_CEILING).pPa);
  });
});

describe('lifting gases (ideal gas at ambient p,T)', () => {
  test('molar masses are real', () => {
    expect(GASES.find(g => g.id === 'vacuum')!.molarMass).toBe(0);
    near(GASES.find(g => g.id === 'helium')!.molarMass, 0.004002602, 1e-9);
    near(GASES.find(g => g.id === 'hydrogen')!.molarMass, 0.00201588, 1e-9);
  });
  test('sea-level densities vs the handbook (He 0.169, H₂ 0.085 kg/m³)', () => {
    near(gasRho('helium', 0), 0.1692, 5e-4);
    near(gasRho('hydrogen', 0), 0.0853, 5e-4);
    expect(gasRho('vacuum', 0)).toBe(0);
  });
  test('sea-level NET lift per m³: vacuum 1.225, He ≈ 1.056, H₂ ≈ 1.140', () => {
    near(liftKg('vacuum', 1, 0), 1.225, 3e-4);
    near(liftKg('helium', 1, 0), 1.056, 2e-3);
    near(liftKg('hydrogen', 1, 0), 1.140, 2e-3);
    // the strict ordering every dirigible plot obeys
    expect(liftKg('vacuum', 1, 0)).toBeGreaterThan(liftKg('hydrogen', 1, 0));
    expect(liftKg('hydrogen', 1, 0)).toBeGreaterThan(liftKg('helium', 1, 0));
  });
});

describe('equilibrium altitude (lift = mass)', () => {
  test('a 1000 m³ He craft at 500 kg floats at ~7 km — and liftKg re-scores it', () => {
    const eq = equilibrium('helium', 1000, 500);
    expect(eq.sinks).toBe(false);
    expect(eq.m).toBeGreaterThan(5000);
    expect(eq.m).toBeLessThan(9000);
    near(liftKg('helium', 1000, eq.m), 500, 0.5);   // the crossing, not a guess
  });
  test('a craft too heavy for sea level SINKS', () => {
    const eq = equilibrium('helium', 10, 100);
    expect(eq.sinks).toBe(true);
    expect(eq.m).toBe(0);
  });
  test('a near-frictionless giant reads the ceiling branch', () => {
    const eq = equilibrium('vacuum', 1e6, 1);      // 10⁶ m³ lifting 1 kg
    expect(eq.sinks).toBe(false);
    expect(eq.atCeiling).toBe(true);
  });
  test('ordering: vacuum floats HIGHER than helium for the same craft', () => {
    const v = equilibrium('vacuum', 2000, 1500);
    const he = equilibrium('helium', 2000, 1500);
    expect(v.sinks).toBe(false); expect(he.sinks).toBe(false);
    expect(v.m).toBeGreaterThan(he.m);
  });
  test('zero volume = sinks (never a divide blowup)', () => {
    expect(equilibrium('helium', 0, 1).sinks).toBe(true);
  });
  test('maxFloatMassKg IS the weight limit: lift at altitude, falling with h', () => {
    near(maxFloatMassKg('hydrogen', 300, 5000), liftKg('hydrogen', 300, 5000), 1e-12);
    expect(maxFloatMassKg('helium', 300, 2000)).toBeLessThan(maxFloatMassKg('helium', 300, 0));
  });
});

describe('envelopeVolume — divergence sum over the exact lattice', () => {
  const tri = (a: Corner, b: Corner, c: Corner) => {
    const t = triangleFromCorners(a, b, c, [51]);
    if (!t) throw new Error('degenerate test triangle');
    return t;
  };
  // signed volume of tetra (a,b,c,d) from a — its sign is the side d sits
  // on; a face (a,b,c) is OUTWARD when the opposite vertex reads NEGATIVE.
  const tetVol = (a: Corner, b: Corner, c: Corner, d: Corner) => {
    const u: Corner = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v: Corner = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const w: Corner = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    return (u[0] * (v[1] * w[2] - v[2] * w[1])
          - u[1] * (v[0] * w[2] - v[2] * w[0])
          + u[2] * (v[0] * w[1] - v[1] * w[0])) / 6;
  };
  const face = (a: Corner, b: Corner, c: Corner, opp: Corner): Triangle =>
    tetVol(a, b, c, opp) < 0 ? tri(a, b, c) : tri(a, c, b);

  test('a tetrahedron of 1 m legs: 1/6 m³ (and the winding helper is outward)', () => {
    const A: Corner = [6, 6, 6], B: Corner = [10, 6, 6], C: Corner = [6, 10, 6], D: Corner = [6, 6, 10];
    const skin = [face(A, B, C, D), face(A, B, D, C), face(A, C, D, B), face(B, C, D, A)];
    // outward ⇒ the closed-surface sum 6V = Σ v0·(v1 × v2) reads POSITIVE
    // (decode each record back to lattice corners g = v + 12·frame)
    let s6 = 0;
    for (const t of skin) {
      const g = (i: number, ax: 'x' | 'y' | 'z'): number =>
        ((t[`v${i}_${ax}`] as number) ?? 0) + 12 * t[`frame_${ax}`];
      const v0: Corner = [g(0, 'x'), g(0, 'y'), g(0, 'z')];
      const v1: Corner = [g(1, 'x'), g(1, 'y'), g(1, 'z')];
      const v2: Corner = [g(2, 'x'), g(2, 'y'), g(2, 'z')];
      s6 += v0[0] * (v1[1] * v2[2] - v2[1] * v1[2])
          - v0[1] * (v1[0] * v2[2] - v2[0] * v1[2])
          + v0[2] * (v1[0] * v2[1] - v1[1] * v2[0]);
    }
    expect(s6).toBeGreaterThan(0);
    const env = envelopeVolume(skin);
    expect(env.tris).toBe(4);
    near(env.m3, 1 / 6, 1e-12);
  });

  test('a 1 m cube skin: exactly 1 m³, winding-agnostic (abs)', () => {
    const lo = 6, hi = 10;
    const p = (x: 0 | 1, y: 0 | 1, z: 0 | 1): Corner =>
      [x ? hi : lo, y ? hi : lo, z ? hi : lo];
    // 12 hand-wound OUTWARD triangles (cross products verified per face):
    const skin: Triangle[] = [
      tri(p(1, 0, 0), p(1, 1, 0), p(1, 0, 1)), tri(p(1, 1, 0), p(1, 1, 1), p(1, 0, 1)),   // +x
      tri(p(0, 0, 0), p(0, 0, 1), p(0, 1, 0)), tri(p(0, 0, 1), p(0, 1, 1), p(0, 1, 0)),   // −x
      tri(p(0, 1, 0), p(0, 1, 1), p(1, 1, 0)), tri(p(1, 1, 0), p(0, 1, 1), p(1, 1, 1)),   // +y
      tri(p(0, 0, 0), p(1, 0, 0), p(0, 0, 1)), tri(p(1, 0, 0), p(1, 0, 1), p(0, 0, 1)),   // −y
      tri(p(0, 0, 1), p(1, 0, 1), p(0, 1, 1)), tri(p(1, 0, 1), p(1, 1, 1), p(0, 1, 1)),   // +z
      tri(p(0, 0, 0), p(0, 1, 0), p(1, 0, 0)), tri(p(1, 0, 0), p(0, 1, 0), p(1, 1, 0)),   // −z
    ];
    near(envelopeVolume(skin).m3, 1, 1e-12);
    // EVERY triangle wind-flipped still reads 1 m³ (the abs is the widget's
    // "never lie by sign" guarantee, not a geometry claim)
    const flipped = skin.map(t => {
      const o = { ...t } as Record<string, unknown>;
      for (const ax of ['x', 'y', 'z']) { const s = o[`v1_${ax}`]; o[`v1_${ax}`] = o[`v2_${ax}`]; o[`v2_${ax}`] = s; }
      return o as unknown as Triangle;
    });
    near(envelopeVolume(flipped).m3, 1, 1e-12);
  });

  test('a generated SPHERE SKIN agrees with the planner’s own volume', () => {
    const plan = spherePlan({ rx: 2, ry: 2, rz: 2 });
    const skin: Triangle[] = [];
    for (const [i, j, k] of plan.faces) {
      const t = encodeSkinTri([plan.shell[i]!, plan.shell[j]!, plan.shell[k]!], { slot: 51 });
      if (t) skin.push(t);
    }
    const env = envelopeVolume(skin);
    expect(env.tris).toBe(skin.length);
    near(env.m3, plan.stats.volumeM3, 1e-9);
    // sanity: the lattice hull wraps the ideal 4/3πr³ sphere from OUTSIDE
    expect(env.m3).toBeGreaterThan((4 / 3) * Math.PI * 8);
  });

  test('empty/open meshes are never NaN', () => {
    expect(envelopeVolume([]).m3).toBe(0);
    expect(Number.isFinite(envelopeVolume([tri([6, 6, 6], [10, 6, 6], [6, 10, 6])]).m3)).toBe(true);
  });
});
