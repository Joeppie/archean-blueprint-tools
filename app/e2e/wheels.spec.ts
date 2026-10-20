// wheels.spec.ts — per-component WHEEL render pins (user 2026-10-19: on the
// ISW crawler a caster rendered "sticking up" in the app after the droop
// retirement, while the legacy JS viewer hangs it BELOW the mount). Law
// (app/src/engine/compparts.ts displayQuat): MODERN (conjugate) files hang
// the suspension arm to −y about the world axle (the in-game loaded pose;
// the file stores the horizontal BUILD pose); LEGACY (raw-quat) files keep
// the wheelpair-verified dev-matching build pose untouched. ISW-241
// (3812927875) front caster ci=7 (file quat x̂−90) must land on the same
// world box the byte-similar legacy craft 3518436870 produces for the same
// part; the rear pair (180°-diagonal mount) already hangs and must not move.
import { expect, test, type Page } from '@playwright/test';

type Box = { min: [number, number, number]; max: [number, number, number] };
type W = { __ARCHEAN__?: {
  engine: {
    compRealBox(ci: number): Box | null;
    blueprint: { data: { components: { type: string }[] } } | null;
  };
} };

async function openCraft(page: Page, craft: string, type: RegExp): Promise<number[]> {
  test.setTimeout(60_000);
  await page.goto(`/?craft=${craft}`);
  const find = () => page.evaluate((src) =>
    (window as unknown as W).__ARCHEAN__?.engine?.blueprint?.data.components
      .map((c, ci) => (new RegExp(src).test(c.type) ? ci : -1)).filter(i => i >= 0) ?? [], type.source);
  await expect.poll(find, { timeout: 40_000 }).not.toHaveLength(0);
  const cis = await find();
  await expect.poll(() => page.evaluate((cis) =>
    (window as unknown as W).__ARCHEAN__?.engine!.compRealBox(cis[0]) ?? null, cis),
  { timeout: 40_000, intervals: [250, 500, 1000] }).not.toBeNull();
  return cis;
}

test.describe('ISW crawler wheels hang below their mounts @models @slow', () => {
  const desktopOnly = () => test.skip(test.info().project.name !== 'chromium', 'desktop-only');

  test('modern ISW: front caster hangs (0.313..1.124), rear pair unchanged @SmallWheel', async ({ page }) => {
    desktopOnly();
    const cis = await openCraft(page, '3812927875', /^SmallWheel$/);
    expect(cis.length).toBe(3);
    const boxes = await page.evaluate((cis) =>
      cis.map(ci => (window as unknown as W).__ARCHEAN__!.engine.compRealBox(ci)!), cis);
    const front = boxes.find(b => b!.max[1] > 1.0 && Math.abs((b!.min[0] + b!.max[0]) / 2) < 0.5)!;
    // hanging: apex stays at the mount (part y = 1.009 + hub), NO 1.705 stick-up
    expect(front.max[1], `front caster top ${front.max[1]} (sticking-up regression > 1.14)`).toBeLessThan(1.14);
    expect(front.min[1], 'front caster reaches toward the ground').toBeLessThan(0.4);
    const rears = boxes.filter(b => b !== front).map(b => b!);
    for (const r of rears) {
      expect(r.min[1], `rear caster bottom ${r.min[1]}`).toBeCloseTo(0.188, 2);
      expect(r.max[1], `rear caster top ${r.max[1]}`).toBeCloseTo(0.999, 2);
    }
  });

  test('legacy semi truck: build pose kept (droop OFF for raw-quat files) @SmallWheel @BigWheel', async ({ page }) => {
    desktopOnly();
    const cis = await openCraft(page, '3481322297', /^BigWheel$/);
    const boxes = await page.evaluate((cis) =>
      cis.map(ci => (window as unknown as W).__ARCHEAN__!.engine.compRealBox(ci)!), cis);
    // UPRIGHT build pose, height 2.006 m. These numbers moved from the
    // v1.5.10 pins (-2.004/-0.774, height 1.23 = the 90° suspension ROLL)
    // because normalize's palette embedding used to hide the file's legacy
    // flag from the engine, so the documented "droop OFF for raw-quat
    // files" exclusion (the wheelpair truck-leg arbitration) never actually
    // fired IN THE APP — the old numbers pinned that dormant bug. The flag
    // is stamped from the file as on disk now (savefidelity.test.ts), the
    // exclusion finally applies, and the truck stands its wheels up.
    for (const b of boxes) {                    // wheelpair-verified truck pose
      expect(b!.min[1], `truck BigWheel bottom ${b!.min[1]}`).toBeCloseTo(-1.941, 2);
      expect(b!.max[1], `truck BigWheel top ${b!.max[1]}`).toBeCloseTo(0.065, 2);
    }
  });
});
