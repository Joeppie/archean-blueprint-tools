// propeller.test.ts — the data-generated propeller surface (MATRIX.md
// §Propeller gap): the game raytraces the blade from data, so the render
// MUST honour blades/radius/width/twist/pitch instead of the frozen gltf
// template. Formulas transcribed from the dev's propellerGeometry
// (NOTICE §2) — these pins lock the transcription.
import { describe, expect, it } from 'vitest';
import { propellerParams, propellerSurface } from '../propeller';

const extent = (v: number[]) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < v.length; k += 3) {
    for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a]!, v[k + a]!); mx[a] = Math.max(mx[a]!, v[k + a]!); }
  }
  return { mn: mn as number[], mx: mx as number[] };
};

// the MATRIX fixture pair's data (make_matrix_test.py)
const REST = { blades: 4, radius: 1.2, width: 0.25, twist: 0, pitch: 0 };
const DEFLECT = { blades: 6, radius: 1.2, width: 0.25, twist: 10, pitch: 0.5 };

const tris = (v: number[]) => v.length / 9;
// per blade: RADIAL × (4·CHORD surface tris (top+bottom) + 4 edge tris) + hub
const TRI = (blades: number) => blades * 56 * (4 * 12 + 4) + 20 * 4;

describe('propellerSurface', () => {
  it('parameter fallbacks + clamps mirror the client', () => {
    expect(propellerParams({})).toMatchObject({ blades: 3, radius: 0.7, width: 0.3, twist: 0, pitch: 0, hubRadius: 0.1 });
    expect(propellerParams({ blades: 0 })).toMatchObject({ blades: 3 });      // `||` fallback: 0 reads unset
    expect(propellerParams({ blades: 20 }).blades).toBe(12);                  // clamped 1..12
    expect(propellerParams({ radius: 0 }).radius).toBe(0.7);                  // 0 → fallback (dev `||`)
    expect(propellerParams({ width: 0.8 }).hubRadius).toBe(0.2);              // max(0.1, width/4)
    expect(propellerParams({ width: 0.25 }).hubRadius).toBe(0.1);             // client-fixed base floor
  });

  it('blade count is geometry, not a template (triangles scale with blades)', () => {
    expect(tris(propellerSurface(REST).v)).toBe(TRI(4));
    expect(tris(propellerSurface(DEFLECT).v)).toBe(TRI(6));
    expect(tris(propellerSurface({ ...REST, blades: 12 }).v)).toBe(TRI(12));
  });

  it('radius drives the span: rest pair spans ±radius with a rounded tip', () => {
    for (const r of [0.7, 1.2, 3]) {
      const e = extent(propellerSurface({ ...REST, radius: r }).v);
      // tip chord → 0, so extreme vertices reach the full radius on the axes
      expect(e.mx[0], `+x for r=${r}`).toBeCloseTo(r, 6);
      expect(e.mn[0]).toBeCloseTo(-r, 6);                                     // 4 blades: 0/90/180/270°
      expect(e.mx[2]).toBeCloseTo(r, 6);
    }
  });

  it('twist shears the blade out of the disc plane', () => {
    const flat = extent(propellerSurface(REST).v);
    expect(Math.max(-flat.mn[1]!, flat.mx[1]!)).toBeCloseTo(REST.width / 4, 6);   // hub half-height only
    const tw = extent(propellerSurface({ ...REST, twist: 10 }).v);
    expect(Math.max(-tw.mn[1]!, tw.mx[1]!)).toBeGreaterThan(0.5);                 // 5·(x/r)·z shear
  });

  it('pitch rotates the section in Y·Z (angle = pitch·π/4)', () => {
    const p0 = extent(propellerSurface(REST).v);
    const p2 = extent(propellerSurface({ ...REST, pitch: 2 }).v);               // 90°: y ≈ −z
    expect(Math.max(-p0.mn[1]!, p0.mx[1]!)).toBeLessThan(0.1);
    expect(Math.max(-p2.mn[1]!, p2.mx[1]!)).toBeGreaterThan(0.2);               // chord 0.25 at midspan
  });

  it('hub radius honours max(0.1, width/4) in the soup', () => {
    // the hub wall/cap rim sits exactly at that radius (blade vertices
    // coincide with it only by accident)
    const at = (s: { v: number[] }, R: number) => {
      let n = 0;
      for (let k = 0; k < s.v.length; k += 3) {
        if (Math.abs(Math.hypot(s.v[k]!, s.v[k + 2]!) - R) < 1e-9) n++;
      }
      return n;
    };
    expect(at(propellerSurface({ blades: 4, radius: 1.2, width: 0.8 }), 0.2)).toBeGreaterThan(100);
    expect(at(propellerSurface(REST), 0.1)).toBeGreaterThan(100);              // base-floor branch
    expect(at(propellerSurface(REST), 0.0625)).toBeLessThan(100);              // width/4 NOT used here
  });
});
