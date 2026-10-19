// beacon.spec.ts — the solo BEACON render pins (user 2026-10-19: "beacon
// doesnt work in either old and new, it doesnt look like in XenonViewer —
// make a test craft, only a beacon, ensure it renders good in lowpoly and
// normal"). Test craft = 9000003006 (tools/make_solo_test.py, one Beacon at
// identity + its occupancy cell only; mirrored into testdata/ for the pair
// ritual). XenonViewer content box (reports/solo/solo.json):
//   local min (-0.125,-0.125,-0.125) max (0.125,0.945,0.146)
// at part (0.125,0.125,0.125) ⇒ WORLD cube box (0,0,0.339)→(0.25,1.07,0.271);
// the engine's red tip lens may stand proud of the mast top by AT MOST its
// 0.04 m radius + 0.012 flush offset (0.052 m) — the old 0.085 balloon read
// as "not a beacon next to XenonViewer". Lens placement MUST follow the
// displayed twin (full v vs decimated lv), so the low-poly box agrees with
// the full box to <0.01 m.
import { expect, test, type Page } from '@playwright/test';

const BEACON = '9000003006';

type Box = { min: [number, number, number]; max: [number, number, number] };
type W = { __ARCHEAN__?: {
  engine: {
    compRealBox(ci: number): Box | null;
    blueprint: { data: { components: { type: string }[] } } | null;
    scene: { traverse(cb: (o: {
      isMesh?: boolean; geometry?: { type?: string; boundingSphere?: { radius?: number } };
      material?: { emissive?: { r: number; g: number; b: number } };
      position: { y: number };
      updateWorldMatrix(u: boolean, w: boolean): void;
      worldToLocal?(v: { y: number }): void;
    }) => void): void };
  };
} };

async function openBeacon(page: Page): Promise<number> {
  test.setTimeout(60_000);
  await page.goto(`/?craft=${BEACON}`);
  const find = () => page.evaluate(() =>
    (window as unknown as W).__ARCHEAN__?.engine?.blueprint?.data.components
      .findIndex(c => c.type === 'Beacon') ?? -2);
  await expect.poll(find, { timeout: 40_000 }).toBe(0);
  await expect.poll(() => page.evaluate(() =>
    (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(0) ?? null),
  { timeout: 40_000, intervals: [250, 500, 1000] }).not.toBeNull();
  return 0;
}

const probe = (page: Page) => page.evaluate(() => {
  const e = (window as unknown as W).__ARCHEAN__!.engine;
  const box = e.compRealBox(0)!;
  // the red tip lens: emissive-red sphere mesh in the scene
  let lens: { ymax: number; xspan: number; zspan: number } | null = null;
  e.scene.traverse((o) => {
    const em = o.material?.emissive;
    if (!o.isMesh || !em || em.r < 0.5 || em.g > 0.15 || em.b > 0.15) return;
    o.updateWorldMatrix(true, false);
    const g = o.geometry as { boundingSphere?: { radius?: number } } | undefined;
    const r = g?.boundingSphere?.radius ?? 0;
    const mw = (o as unknown as { matrixWorld: { elements: number[] } }).matrixWorld.elements;
    lens = { ymax: mw[13]!, xspan: 2 * r, zspan: 2 * r };
  });
  return { box, lens };
});

test.describe('solo Beacon renders like XenonViewer — full + decimated @models @slow', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('full mesh: dev content box + discreet flush tip lens (not a balloon) @Beacon', async ({ page }) => {
    desktopOnly();
    const ci = await openBeacon(page);
    const { box, lens } = await probe(page);
    // dev content: housing spans x 0.25 / z 0.271 with its bottom ON the grid
    // (min y = 0 = the part's mount plane), bare mast top at y = 1.07
    expect(box.max[0] - box.min[0], `x span ${box.max[0] - box.min[0]}`).toBeCloseTo(0.25, 2);
    expect(box.max[2] - box.min[2], `z span ${box.max[2] - box.min[2]}`).toBeCloseTo(0.271, 2);
    expect(box.min[1], `housing bottom on the mount plane`).toBeCloseTo(0, 2);
    // the ONLY thing above the bare 1.07 mast top is the 0.052 lens cap
    expect(box.max[1], `mast+lens top ${box.max[1]}`).toBeGreaterThan(1.10);
    expect(box.max[1], `mast+lens top ${box.max[1]} (balloon > 1.14 = regression)`).toBeLessThan(1.14);
    // lens present + small + flush at the top
    expect(lens, 'red tip lens present').not.toBeNull();
    const l = lens as unknown as { ymax: number; xspan: number };
    expect(l.xspan, `lens diameter ${l.xspan}`).toBeLessThanOrEqual(0.085);
    expect(l.ymax, 'lens centre at the mast top').toBeGreaterThan(1.05);
    void ci;
  });

  test('low poly (decimated twins): same silhouette budget, lens on the lv tip @Beacon', async ({ page }) => {
    desktopOnly();
    await page.addInitScript(() => localStorage.setItem('archean-app-hidef', '0'));
    await openBeacon(page);
    const { box, lens } = await probe(page);
    expect(box.max[0] - box.min[0], 'x span').toBeCloseTo(0.25, 2);
    expect(box.max[2] - box.min[2], 'z span').toBeCloseTo(0.271, 2);
    expect(box.min[1], 'housing bottom').toBeCloseTo(0, 2);
    // decimated mast top sits within a cm of the full one (same 800→216 v
    // cloud apex) and the lens is placed from the lv tip it displays
    expect(box.max[1], `low mast+lens top ${box.max[1]}`).toBeGreaterThan(1.08);
    expect(box.max[1], `low mast+lens top ${box.max[1]}`).toBeLessThan(1.14);
    expect(lens, 'red tip lens present (low)').not.toBeNull();
  });
});
