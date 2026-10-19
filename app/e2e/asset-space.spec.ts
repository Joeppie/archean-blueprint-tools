// asset-space.spec.ts — the engine content basis measured END TO END
// (FORMAT §Per-asset gltf VERTEX SPACE; XenonViewer = the arbiter). The solo
// fixtures (tools/make_solo_test.py, one component at IDENTITY orientation)
// put the part frame == the world frame, so the real-model bbox spans pin
// the exact dev content map  C·chain·C⁻¹·v  (expected values computed from
// the atlas + .ini in the C basis — the same clouds the dev viewer draws).
// Sign-sensitive across ALL three historic configs (raw-file, per-asset
// bake, C-basis): only the current one passes.
import { expect, test, type Page } from '@playwright/test';

const RAD = '9000003001';       // ActiveRadiator
const AIL = '9000003002';       // Aileron
const TRASH = '9000003102';     // TrashCan
const TOGGLE = '9000003100';    // ToggleButton

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

test.describe('engine content basis C·chain·C⁻¹ (solo fixtures) @models @slow', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('ActiveRadiator: slab spans X·Y, thin Z (dev content, spans 0.99/0.99/0.38)', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, RAD, 'ActiveRadiator');
    const s = spans((await page.evaluate((ci) =>
      (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(ci)!, ci)));
    expect(s[0], `x ${s[0]}`).toBeGreaterThan(0.9);
    expect(s[1], `y ${s[1]} (baked-file frame: 0.72 — slab tipped)`).toBeGreaterThan(0.9);
    expect(s[2], `z ${s[2]} (raw-file frame: 0.72)`).toBeLessThan(0.55);
  });

  test('Aileron: wing plate spans X·Z, thin Y (dev content, spans 1.0/0.25/1.01)', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, AIL, 'Aileron');
    const s = spans((await page.evaluate((ci) =>
      (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(ci)!, ci)));
    expect(s[0], `x ${s[0]}`).toBeGreaterThan(0.9);
    expect(s[1], `y ${s[1]} (raw: 0.48 / baked-file: 1.01)`).toBeLessThan(0.4);
    expect(s[2], `z ${s[2]} (raw 0.76 / baked 0.48)`).toBeGreaterThan(0.9);
  });

  test('TrashCan: drum along Y at identity mount (dev content, spans 0.5/0.72/0.5)', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, TRASH, 'TrashCan');
    const s = spans((await page.evaluate((ci) =>
      (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(ci)!, ci)));
    expect(s[1], `y ${s[1]} (baked-file: 0.5 tipped)`).toBeGreaterThan(0.65);
    expect(s[2], `z ${s[2]} (baked-file: 0.72)`).toBeLessThan(0.6);
  });

  test('ToggleButton: lever stack thin X/Y, +0.37 along Z (dev content)', async ({ page }) => {
    desktopOnly();
    const ci = await openPart(page, TOGGLE, 'ToggleButton');
    const s = spans((await page.evaluate((ci) =>
      (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(ci)!, ci)));
    expect(s[0], `x ${s[0]}`).toBeLessThan(0.3);
    expect(s[1], `y ${s[1]} (raw: 0.44)`).toBeLessThan(0.32);
    expect(s[2], `z ${s[2]} (raw: 0.63)`).toBeGreaterThan(0.25);
    expect(s[2], `z ${s[2]} (raw: 0.63)`).toBeLessThan(0.5);
  });
});
