// asset-space.spec.ts — the REAL-model vertex space, measured end-to-end
// (AGENTS §Known open issues: per-asset alignment must be pinned on WORLD
// bboxes, sign-sensitive — the v0.145 lesson). The matrix fixtures stand the
// parts at IDENTITY orientation, so the part frame IS the world frame and the
// real-model bbox spans arbitrate directly against the .ini collider:
//   ActiveRadiator  thin-Y slab (collider y 0.25):  baked z-span > y-span
//                   (raw = the mirrored pair, part "standing on edge")
//   Aileron         flat wing plate:               baked z-span thin (<0.5),
//                   chord rides in Y               (raw = z-span 0.76, thin in Y)
//   TrashCan        0.72 m long can lying along Z: baked z-span > y-span
//                   (raw = can sticking UP out of its cell)
import { expect, test, type Page } from '@playwright/test';

const REST = '9000001001';       // ActiveRadiator, Aileron, AltitudeSensor
const REST2 = '9000001034';      // ToggleButton, ToiletSeat, TrashCan

type Box = { min: [number, number, number]; max: [number, number, number] };
type W = { __ARCHEAN__?: {
  engine: {
    compRealBox(ci: number): Box | null;
    blueprint: { data: { components: { type: string }[] } } | null;
  };
} };

const spans = (b: Box) => [0, 1, 2].map(a => +(b.max[a] - b.min[a]).toFixed(3));

async function openPart(page: Page, id: string, type: string): Promise<number> {
  test.setTimeout(60_000);
  await page.goto(`/?craft=${id}`);
  const find = () => page.evaluate((t) =>
    (window as unknown as W).__ARCHEAN__?.engine?.blueprint?.data.components
      .findIndex(c => c.type === t) ?? -2, type);
  await expect.poll(find, { timeout: 40_000 }).toBeGreaterThanOrEqual(0);
  const ci = await find();
  await expect.poll(() => page.evaluate((ci) =>
    (window as unknown as W).__ARCHEAN__?.engine?.compRealBox(ci) ?? null, ci),
  { timeout: 40_000, intervals: [250, 500, 1000] }).not.toBeNull();
  return ci;
}

test.describe('per-asset vertex space (world bboxes)', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('ActiveRadiator lies FLAT: Z-span exceeds Y-span (thin-Y collider)', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, REST, 'ActiveRadiator');
    const s = spans((await page.evaluate((ci) =>
      (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(ci)!, ci)));
    expect(s[0], `x-span ${s[0]}`).toBeGreaterThan(0.9);        // 1 m slab width
    expect(s[2] - s[1], `z−y = ${(s[2] - s[1]).toFixed(3)} (raw: inverted)`)
      .toBeGreaterThan(0.15);                                    // sign-sensitive
    expect(s[1], `y-span ${s[1]} (standing fan = 0.99)`).toBeLessThan(0.9);
  });

  test('Aileron is a flat plate in X·Y: Z-span thin, chord in Y', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, REST, 'Aileron');
    const s = spans((await page.evaluate((ci) =>
      (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(ci)!, ci)));
    expect(s[0], `x-span ${s[0]}`).toBeGreaterThan(0.9);
    expect(s[2], `z-span ${s[2]} (raw: 0.76 upright)`).toBeLessThan(0.5);
    expect(s[1], `y-span ${s[1]} (raw: 0.48)`).toBeGreaterThan(0.6);
  });

  test('TrashCan lies along Z (collider ±0.47·Z): does NOT stick up', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, REST2, 'TrashCan');
    const s = spans((await page.evaluate((ci) =>
      (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(ci)!, ci)));
    expect(s[2] - s[1], `z−y = ${(s[2] - s[1]).toFixed(3)} (raw: can upright)`).toBeGreaterThan(0.15);
  });

  test('ToggleButton stays RAW (tie default): lever arm reaches z −0.46, y stays > −0.32',
    async ({ page }) => {
      desktopOnly();
      const ci = await openPart(page, REST2, 'ToggleButton');
      const r = await page.evaluate((ci) => {
        const e = (window as unknown as W).__ARCHEAN__!.engine;
        const b = e.compRealBox(ci)!, p = e.blueprint!.data.components[ci].position;
        return { zmin: b.min[2] - p.z, ymin: b.min[1] - p.y };
      }, ci);
      // RAW cloud spans (0.25, 0.43, 0.63) with the display yaw-180 flipping
      // the lever to −z; a BAKE would swap them to (0.25, 0.63, 0.43).
      expect(r.zmin, `local z-min ${r.zmin} (baked: ≥ −0.24)`).toBeLessThan(-0.35);
      expect(r.ymin, `local y-min ${r.ymin} (baked: −0.46)`).toBeGreaterThan(-0.32);
    });
});
