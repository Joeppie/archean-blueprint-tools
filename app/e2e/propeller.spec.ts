// propeller.spec.ts — the MATRIX pair pin for the data-GENERATED propeller
// (MATRIX.md §Propeller gap → closed): the blade surface must follow
// data.blades/radius/width/twist/pitch, not the frozen gltf template.
// The rest twin (9000001024: 4 blades, r 1.2, w 0.25, twist/pitch 0) and the
// deflected twin (9000002024: 6 blades, twist 10, pitch 0.5) render through
// the shipped buildReal chain; engine.compRealBox measures the REAL model.
import { expect, test, type Page } from '@playwright/test';

const REST = '9000001024';
const DEFLECT = '9000002024';

type Box = { min: [number, number, number]; max: [number, number, number] };
type Eng = {
  compRealBox(ci: number): Box | null;
  blueprint: { data: { components: { type: string }[] } } | null;
};
type W = { __ARCHEAN__?: { engine: Eng } };

const findProp = (page: Page) => page.evaluate(() => {
  const e = (window as unknown as W).__ARCHEAN__?.engine;
  return e?.blueprint?.data.components.findIndex(c => c.type === 'Propeller') ?? -2;
});
const box = (page: Page, ci: number) =>
  page.evaluate((ci) => (window as unknown as W).__ARCHEAN__?.engine?.compRealBox(ci) ?? null, ci);

async function openProp(page: Page, id: string): Promise<number> {
  test.setTimeout(60_000);
  await page.goto(`/?craft=${id}`);
  // matrix fixtures are parts-only: no blocks ⇒ the SCENE PASS title gate
  // never fires (stats.ok wants solids) — wait for the prop component and
  // then for the REAL model streaming in (the generated soup).
  await expect.poll(() => findProp(page), { timeout: 40_000 }).toBeGreaterThanOrEqual(0);
  const ci = await findProp(page);
  await expect.poll(() => box(page, ci), { timeout: 40_000, intervals: [250, 500, 1000] })
    .not.toBeNull();
  return ci;
}

const span = (b: Box, a: 0 | 1 | 2) => b.max[a] - b.min[a];
const diag = (b: Box) => Math.hypot(span(b, 0), span(b, 1), span(b, 2));

test.describe('generated propeller (matrix pair)', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  // The disc plane carries the .ini axle mount tilt (−90° x, −33.45° y), so
  // per-axis WORLD spans understate r; the bbox DIAGONAL is mount-robust:
  // a full disc of radius r spans 2r across the plane and 2r·cos α over the
  // blade angles α — 4 blades hit cos = 1, 6 blades cos 30°.
  //   data r = 1.2 → rest 4-blade diag ≈ 3.36, 6-blade ≈ 3.17
  //   frozen gltf template (r = 0.88, same mount): rest ≈ 2.49
  // So: rest diag > 2.9 proves GENERATION (template tops out at 2.49);
  // deflected < rest proves the blade COUNT feeds the geometry — the static
  // template is identical for both fixtures.
  test('rest twin: generated r = 1.2 m disc, flat (hub-thick out-of-plane)', async ({ page }) => {
    desktopOnly();
    const ci = await openProp(page, REST);
    const b = (await box(page, ci))!;
    const d = diag(b);
    expect(d, `rest diag ${d.toFixed(3)} (template: 2.49)`).toBeGreaterThan(2.9);
    expect(d, `rest diag ${d.toFixed(3)} (full disc 2√2r = 3.39)`).toBeLessThan(3.6);
    // flat disc + tilt: the smallest axis span is the hub width (0.125) plus
    // the tilt cone of the in-plane extents (≈ 0.83 for −33.45°/−90°)
    const outOfPlane = Math.min(span(b, 0), span(b, 1), span(b, 2));
    expect(outOfPlane, `min span ${outOfPlane.toFixed(3)}`).toBeLessThan(1.15);
    expect(outOfPlane, `min span ${outOfPlane.toFixed(3)} (hub not lost)`).toBeGreaterThan(0.1);
  });

  test('deflected twin: twist/pitch spread the surface OUT OF PLANE beyond the rest twin', async ({ page }) => {
    desktopOnly();
    // (measured 2026-10-19) rest r1.2 4-blade flat: spans (2.34, 2.40, 1.00);
    // deflected 6-blade twist 10 pitch 0.5: (2.69, 2.40, 2.00). The blade
    // RADIUS holds (mount-vertical span = 2r = 2.4 on both), and the helix
    // (pitch/twist) nearly DOUBLES the out-of-plane extent. (The original
    // 2026-10-19-WIP assertion expected the disc DIAGONAL to SHRINK with
    // blade count — wrong: both discs bbox 2r×2r in plane, the twist effect
    // dominates the diagonal and grows it.)
    const ciR = await openProp(page, REST);
    const bR = (await box(page, ciR))!;
    const ciD = await openProp(page, DEFLECT);      // goto re-mounts the viewport
    const bD = (await box(page, ciD))!;
    const span = (b: Box, a: 0 | 1 | 2) => b.max[a] - b.min[a];
    expect(span(bR, 1), 'rest mount-vertical extent = 2r').toBeGreaterThan(2.3);
    expect(span(bD, 1), 'deflected mount-vertical extent = 2r').toBeGreaterThan(2.3);
    expect(span(bD, 1), 'blade radius identical across the twins').toBeCloseTo(span(bR, 1), 1);
    const oopR = Math.min(...([0, 1, 2] as const).map(a => span(bR, a)));
    const oopD = Math.min(...([0, 1, 2] as const).map(a => span(bD, a)));
    expect(oopD - oopR, `out-of-plane spread grew ${(oopD - oopR).toFixed(2)} m (twist/pitch → data drives geometry)`)
      .toBeGreaterThan(0.5);
  });
});
