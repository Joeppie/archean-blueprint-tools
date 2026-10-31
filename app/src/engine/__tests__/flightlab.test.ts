// flightlab.test.ts — THE FLIGHT LAB pins (v1.16.11 WP-C): the wiki's
// shape-field force laws on the collider census (FORMAT §Aerodynamics is
// normative: thin-broad sections lift, stall ≈ 15°, form drag by
// fineness, EMERGENT stability — CG vs the lift centre, authority =
// area·lever·ρv²).
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Blueprint } from '../format';
import { buriedAt, clAlphaOf, clOf, flightLab, STALL_DEG } from '../flightlab';
import { bodyBoxes } from '../aero';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '../../../../testdata');
const load = (id: string): Blueprint | null => {
  const p = join(CORPUS, id, 'blueprint.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};

describe('flightlab laws (pure)', () => {
  it('lift-curve slope: Diederich finite-wing, monotone in AR', () => {
    expect(clAlphaOf(Infinity)).toBeCloseTo(2 * Math.PI, 3);
    expect(clAlphaOf(8)).toBeGreaterThan(clAlphaOf(4));
    expect(clAlphaOf(2)).toBeCloseTo((2 * Math.PI * 2) / 4, 6);
  });
  it('lift curve: linear pre-stall, peak at 15°, stall shed, odd in α', () => {
    const a = 5;
    const aL = STALL_DEG * Math.PI / 180;
    expect(clOf(5 * Math.PI / 180, a)).toBeCloseTo(a * 5 * Math.PI / 180, 10);
    const peak = clOf(aL, a);
    expect(clOf(20 * Math.PI / 180, a)).toBeLessThan(peak);
    expect(clOf(60 * Math.PI / 180, a)).toBeLessThan(clOf(20 * Math.PI / 180, a));
    expect(clOf(-8 * Math.PI / 180, a)).toBeCloseTo(-clOf(8 * Math.PI / 180, a), 12);
  });
  it('buriedAt: the point census of the collider boxes', () => {
    const boxes = bodyBoxes(load('9000009080')!);
    expect(buriedAt(boxes, [0, 0, 0.75])).toBe(true);     // fuselage core
    expect(buriedAt(boxes, [5, 0, 0.75])).toBe(false);    // far off the wing
  });
});

describe('FLIGHT BENCH fixtures (9000009080/81/82)', () => {
  it('the stable bench: thin broad wing, CG ahead of the lift centre', () => {
    const r = flightLab(load('9000009080')!, null, { speed: 60 })!;
    expect(r).toBeTruthy();
    // wing: 6 m span × 2 m chord (frame-aligned cells, thin in y)
    expect(r.planform.span).toBeCloseTo(6, 0);
    expect(r.planform.S).toBeGreaterThan(11);
    expect(r.planform.S).toBeLessThan(14);
    expect(r.planform.AR).toBeCloseTo(3, 0);              // span²/S
    expect(r.pitchVerdict).toBe('stable');
    expect(r.staticMarginPct).toBeGreaterThan(20);
    expect(r.yawVerdict).toBe('stable');
    expect(r.finArea).toBeGreaterThan(0.2);
    expect(r.stallSpeed).toBeGreaterThan(5);
    expect(r.stallSpeed).toBeLessThan(45);
    expect(Number.isFinite(r.trimAlphaDeg)).toBe(true);
    expect(r.curve.length).toBe(26);
    // the wiki's stall knee: Cl peaks at 15° and falls
    const clPeak = r.curve[STALL_DEG]!.cl;
    expect(r.curve[STALL_DEG + 5]!.cl).toBeLessThan(clPeak);
  });

  it('THE DISCRIMINATING PAIR: same airframe, ballast moved aft = divergent ' +
    '(wiki: stability is a BALANCE problem — the CG moved, not the shape)', () => {
    const stable = flightLab(load('9000009080')!, null, { speed: 60 })!;
    const tailHeavy = flightLab(load('9000009081')!, null, { speed: 60 })!;
    expect(tailHeavy.planform.S).toBeCloseTo(stable.planform.S, 6);   // SAME shape
    expect(tailHeavy.cg[2]).toBeGreaterThan(stable.cg[2]);            // CG aft
    expect(tailHeavy.pitchVerdict).toBe('unstable');
    expect(tailHeavy.staticMarginPct).toBeLessThan(0);
    expect(tailHeavy.staticMarginPct).toBeLessThan(stable.staticMarginPct);
  });

  it('the brick: no thin broad sections — honest no-lift census', () => {
    const r = flightLab(load('9000009082')!, null)!;
    expect(r.planform.S).toBe(0);
    expect(r.pitchVerdict).toBe('unstable');
    expect(r.stallSpeed).toBe(Infinity);
    expect(r.clAlpha).toBe(0);
    expect(r.frontal).toBeGreaterThan(0.2);               // 0.25 m² front + margin
  });
});

describe('corpus census (data laws at the node tier)', () => {
  it('Jimmy’s Adventure (3334698274): a heavy boxy hauler — the report ' +
    'runs and QUANTIFIES why it does not fly stable', () => {
    const bp = load('3334698274');
    if (!bp) return;
    const r = flightLab(bp, null, { speed: 80, altitude: 0 });
    expect(r).toBeTruthy();
    // the pin that matters: the report EXISTS, the mass model runs on the
    // full craft (declared > 1000, the game cache 3334698274.mass), and
    // the craft is NOT pitched-stable (the user: "Jimmy's adventure can't
    // fly stable"). The mass cache may lag the live model by far (hull
    // skin + fluids land in declared first) — the honest bound is 2×.
    expect(r!.mass).toBeGreaterThan(1000);
    expect(r!.mass / (bp.mass as number)).toBeLessThan(2);
    expect(r!.pitchVerdict).not.toBe('stable');
  });

  it('Chip Patton’s Falcon (3348745601): the old-physics plane — its ' +
    'AILERON CENSUS shows the hidden-plate fleet the new field ignores', () => {
    const bp = load('3348745601');
    if (!bp) return;
    const r = flightLab(bp, null, { speed: 80, altitude: 0 });
    expect(r).toBeTruthy();
    expect(r!.mass).toBeGreaterThan(10_000);
    // the user: "Falcon was made for old physics system and has hidden
    // ailerons, these don't do anything anymore" — measured: a 150-plate
    // aileron fleet with the vast majority buried IN the structure
    expect(r!.authority.rows.length).toBeGreaterThan(100);
    const buried = r!.authority.rows.filter(x => x.buried).length;
    expect(buried / r!.authority.rows.length).toBeGreaterThan(0.5);
    // a 30 m flying wing with the CG near the neutral point (the census
    // measured +1.2% — 'neutral'): not divergent, not comfortable
    expect(['neutral', 'unstable']).toContain(r!.pitchVerdict);
  });
});
