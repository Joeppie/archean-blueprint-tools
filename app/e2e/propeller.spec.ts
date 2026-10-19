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

test.describe('generated propeller (matrix pair) @models @slow', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  // Content basis C·chain·C⁻¹ (dev rule; FORMAT §Per-asset gltf VERTEX
  // SPACE): basis-robust pins — the DISC diameter (2r = 2.4) must appear on
  // the two larger world-span axes whatever the mount tilt/basis, the hub +
  // tilt cone on the smallest. The frozen gltf template (r 0.88, same mount)
  // tops out at 1.76 ⇒ mid/max spans > 2.2 prove GENERATION at r = 1.2.
  test('rest twin: generated r = 1.2 m disc, flat (hub-thin smallest axis)', async ({ page }) => {
    desktopOnly();
    const ci = await openProp(page, REST);
    const b = (await box(page, ci))!;
    const s = ([0, 1, 2] as const).map(a => span(b, a)).sort((x, y) => x - y);
    expect(s[1], `mid span ${s[1].toFixed(3)} (template: 1.76)`).toBeGreaterThan(2.2);
    expect(s[2], `max span ${s[2].toFixed(3)} (2r = 2.4 + chord)`).toBeGreaterThan(2.2);
    expect(s[0], `min span ${s[0].toFixed(3)} (hub+tilt cone)`).toBeLessThan(1.4);
    expect(s[0], `min span ${s[0].toFixed(3)} (hub not lost)`).toBeGreaterThan(0.1);
  });

  test('deflected twin: twist/pitch spread the surface OUT OF PLANE beyond the rest twin', async ({ page }) => {
    desktopOnly();
    // sorted spans: radius holds on the two disc axes; the smallest axis
    // (disc normal) GROWS with pitch/twist. (The original 2026-10-19-WIP
    // assertion expected the diagonal to SHRINK with blade count — wrong:
    // both discs bbox 2r×2r in plane; the helix dominates and grows it.)
    const ciR = await openProp(page, REST);
    const bR = (await box(page, ciR))!;
    const ciD = await openProp(page, DEFLECT);      // goto re-mounts the viewport
    const bD = (await box(page, ciD))!;
    const sortSpans = (b: Box) => ([0, 1, 2] as const).map(a => span(b, a)).sort((x, y) => x - y);
    const sR = sortSpans(bR), sD = sortSpans(bD);
    expect(sD[2], 'deflected keeps the disc diameter').toBeGreaterThan(2.2);
    expect(sD[2], 'deflected disc diameter ≈ rest').toBeLessThan(sR[2] + 0.6);
    expect(sD[0] - sR[0], `out-of-plane spread grew ${(sD[0] - sR[0]).toFixed(2)} m (twist/pitch → data drives geometry)`)
      .toBeGreaterThan(0.5);
  });
});
