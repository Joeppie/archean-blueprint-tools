// grid.ts pins (v1.5.21, user: "grid needs to fit build comfortably.
// Probably granularity depending on zoom 1x or 5, 10, depending"): the step
// ladder rides the 0.25 m cell with 1×/5×/10× rungs; the chosen step keeps
// one minor cell readable on screen; the extent COVERS the build (rounded
// out to whole major cells) and the line-count cap BUMPS THE STEP instead
// of holing the coverage.
import { describe, expect, it } from 'vitest';
import { GRID_MAJOR_EVERY, GRID_MAX_LINES, GRID_MIN_PX, GRID_STEPS,
  gridPlan, pickGridStep, pxPerMeter } from '../grid';

describe('step ladder', () => {
  it('rides the 0.25 m cell with 5/10 rungs (the user\'s 1x/5/10)', () => {
    expect(GRID_STEPS[1]).toBe(0.25);           // 1× the blueprint cell
    expect(GRID_STEPS[2]).toBe(1.25);           // 5×
    expect(GRID_STEPS[3]).toBe(2.5);            // 10×
    expect(GRID_STEPS[4]).toBe(12.5);           // 50×
    for (let k = 1; k < GRID_STEPS.length; k++)
      expect((GRID_STEPS[k]! / GRID_STEPS[k - 1]!) % 1).toBeCloseTo(0);   // whole multiples
  });
  it('finest readable step at high zoom, clamped at both ends', () => {
    expect(pickGridStep(1e4)).toBe(GRID_STEPS[0]);            // extreme zoom-in
    expect(pickGridStep(100)).toBe(0.25);                     // 25 px per cell
    expect(pickGridStep(6)).toBe(2.5);                        // 15 px per 2.5 m
    expect(pickGridStep(0.01)).toBe(GRID_STEPS[GRID_STEPS.length - 1]); // orbital
  });
  it('a step is chosen exactly at the MIN_PX threshold', () => {
    expect(pickGridStep(GRID_MIN_PX / 0.25 - 0.001)).toBe(1.25);
    expect(pickGridStep(GRID_MIN_PX / 0.25)).toBe(0.25);
  });
});

describe('pxPerMeter', () => {
  it('matches the pinhole projection of the vertical fov', () => {
    // 400 px tall, 55° fov, 10 m distance: h/2 / (d·tan(27.5°))
    const px = pxPerMeter(800, 55, 10);
    expect(px).toBeCloseTo(400 / (10 * Math.tan(27.5 * Math.PI / 180)), 6);
    expect(pxPerMeter(800, 55, 20)).toBeLessThan(px);          // zoom-out ⇒ fewer px/m
    expect(pxPerMeter(0, 55, 10)).toBe(0);
    expect(pxPerMeter(800, 55, 0)).toBe(0);
  });
});

describe('grid plan', () => {
  it('COVERS the build comfortably and rounds out to whole major cells', () => {
    const plan = gridPlan(3.2, 1.7, 40);         // 6.4 × 3.4 m craft, mid zoom
    expect(plan.major).toBe(plan.step * GRID_MAJOR_EVERY);
    expect(plan.halfX).toBeGreaterThanOrEqual(3.2);
    expect(plan.halfZ).toBeGreaterThanOrEqual(1.7);
    expect(plan.halfX % plan.major).toBe(0);     // major-cell boundary edges
    expect(plan.halfZ % plan.major).toBe(0);
  });
  it('a tiny craft gets the sane minimum pad, not a 1 m postage stamp', () => {
    const plan = gridPlan(0.4, 0.4, 60);
    expect(plan.halfX).toBeGreaterThanOrEqual(8);
    expect(plan.halfZ).toBeGreaterThanOrEqual(8);
  });
  it('zooming out COARSENS the cell (1 → 5 → 10 rhythm), zooming in refines', () => {
    const near = gridPlan(20, 20, 120);          // ~24 px per 0.25 m cell
    const mid = gridPlan(20, 20, 10);
    const far = gridPlan(20, 20, 0.4);
    expect(near.step).toBeLessThan(mid.step);
    expect(mid.step).toBeLessThan(far.step);
    // coverage never shrinks below the build at ANY zoom
    for (const g of [near, mid, far]) {
      expect(g.halfX).toBeGreaterThanOrEqual(20);
      expect(g.halfZ).toBeGreaterThanOrEqual(20);
    }
  });
  it('line cap BUMPS THE STEP — the coverage is never holed', () => {
    // giant footprint at absurdly fine zoom: coverage kept, line count capped
    const plan = gridPlan(600, 600, 1e5);
    expect(plan.halfX).toBeGreaterThanOrEqual(600);
    expect(plan.halfX / plan.step).toBeLessThanOrEqual(GRID_MAX_LINES);
    expect(plan.halfZ / plan.step).toBeLessThanOrEqual(GRID_MAX_LINES);
    expect(GRID_STEPS).toContain(plan.step);     // still a ladder rung
  });
});
